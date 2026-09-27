import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5193;
const DEBUG_PORT = 9200 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

interface CdpMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

interface CdpTarget {
  type: string;
  webSocketDebuggerUrl?: string;
}

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id === undefined) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result ?? {});
    });
    socket.addEventListener("error", () => {
      for (const request of this.pending.values()) {
        request.reject(new Error("Chrome DevTools connection failed"));
      }
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not connect to Chrome DevTools")), { once: true });
    });
    return new CdpClient(socket);
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

async function waitForUrl(url: string, description: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  let lastError = "not reachable";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}: ${lastError}`);
}

async function waitFor(check: () => Promise<boolean>, description: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function getPageTarget(): Promise<CdpTarget> {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const targets = await response.json() as CdpTarget[];
  const target = targets.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
  if (!target?.webSocketDebuggerUrl) throw new Error("Chrome did not expose a page target");
  return target;
}

// Mocks the RDDMS endpoints so dataspace creation can be exercised without a
// backend. A POST captures the collection payload and appends successful IDs to
// the list the next GET returns.
function mockApiScript(): string {
  return `
    (() => {
      window.__dsTest = { dataspaces: ["browser/dataspace"], requests: [], lookups: [] };
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const method = (init && init.method) || "GET";
        if (url.includes("/api/osdu/legal-tags")) {
          window.__dsTest.lookups.push(url);
          return new Response(JSON.stringify({ legalTags: [
            { name: "browser-test-tag", description: "Browser test legal tag" },
            { name: "unused-browser-tag", description: "Not selected by this check" },
          ] }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/api/osdu/entitlements/groups")) {
          window.__dsTest.lookups.push(url);
          return new Response(JSON.stringify({ groups: [
            {
              name: "Browser Owners",
              email: "data.default.owners@browser.dataservices.energy",
              description: "Owner lookup fixture",
            },
            {
              name: "Browser Viewers",
              email: "data.default.viewers@browser.dataservices.energy",
              description: "Viewer lookup fixture",
            },
          ] }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/api/osdu/console")) {
          return new Response(JSON.stringify({ entries: [], total: 0 }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/api/osdu/rdms/mode")) {
          return new Response(JSON.stringify({ mode: "rest", etpAvailable: true, etpUnavailableReason: null }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/api/osdu/rdms/dataspaces") && method === "GET") {
          return new Response(JSON.stringify({ dataspaces: window.__dsTest.dataspaces }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/api/osdu/rdms/dataspaces") && method === "POST") {
          const payload = JSON.parse(init.body);
          window.__dsTest.requests.push({ method, url, payload });
          const name = payload[0].DataspaceId;
          if (name === "browser/failed-space") {
            return new Response(JSON.stringify({ error: "Reservoir DDMS: invalid legal tag" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (!window.__dsTest.dataspaces.includes(name)) window.__dsTest.dataspaces.push(name);
          return new Response(JSON.stringify({ DataspaceId: name }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        return realFetch(input, init);
      };
    })();
  `;
}

async function evaluate<T>(client: CdpClient, expression: string): Promise<T> {
  const response = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  const result = response.result as { value?: T; description?: string; type?: string } | undefined;
  if (!result) throw new Error("Browser evaluation failed: no result");
  if (result.type === "undefined") return undefined as T;
  if (!("value" in result)) throw new Error(`Browser evaluation failed: ${result.description ?? "no value"}`);
  return result.value as T;
}

function clickTestId(client: CdpClient, testId: string): Promise<void> {
  return evaluate<void>(client, `(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el) throw new Error("element not found: ${testId}");
    el.click();
  })()`);
}

// Sets a React-controlled input's value through the native setter so the
// synthetic input event updates component state.
function setInput(client: CdpClient, testId: string, value: string): Promise<void> {
  return evaluate<void>(client, `(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el) throw new Error("input not found: ${testId}");
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
}

async function chooseSuggestion(client: CdpClient, testId: string, text: string): Promise<void> {
  try {
    await waitFor(
      () => evaluate<boolean>(client, `(() => {
        const list = document.querySelector('[data-testid="suggestions-${testId}"]');
        return Array.from(list?.querySelectorAll("button") ?? [])
          .some((button) => button.textContent?.toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
      })()`),
      `the ${text} suggestion for ${testId}`,
      8_000,
    );
  } catch (error) {
    const diagnostic = await evaluate<string>(client, `JSON.stringify({
      lookupCalls: window.__dsTest.lookups,
      inputValue: document.querySelector('[data-testid="${testId}"]')?.value,
      inputFocused: document.activeElement === document.querySelector('[data-testid="${testId}"]'),
      ariaExpanded: document.querySelector('[data-testid="${testId}"]')?.getAttribute("aria-expanded"),
      inputHtml: document.querySelector('[data-testid="${testId}"]')?.outerHTML,
      suggestionText: document.querySelector('[data-testid="suggestions-${testId}"]')?.textContent,
    })`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}; lookup diagnostics: ${diagnostic}`);
  }
  await evaluate<void>(client, `(() => {
    const list = document.querySelector('[data-testid="suggestions-${testId}"]');
    const option = Array.from(list?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent?.toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
    if (!option) throw new Error("suggestion not found: ${text}");
    option.click();
  })()`);
}

async function addManualValue(client: CdpClient, testId: string, value: string): Promise<void> {
  await setInput(client, testId, value);
  await clickTestId(client, `button-add-${testId}`);
}

async function runScenario(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/reservoir-dms` });

  // The "New dataspace" trigger renders.
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[data-testid="button-new-dataspace"]') !== null`),
    "the New dataspace button",
  );

  // Opening the dialog reveals the name input.
  await clickTestId(browser, "button-new-dataspace");
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[data-testid="input-new-dataspace-name"]') !== null`),
    "the new-dataspace dialog",
  );

  // An invalid name is rejected client-side: an error shows and no POST fires.
  await setInput(browser, "input-new-dataspace-name", "bad name");
  await clickTestId(browser, "button-create-dataspace");
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[data-testid="new-dataspace-error"]') !== null`),
    "the validation error for an invalid name",
  );
  assert.deepEqual(
    await evaluate<any[]>(browser, "window.__dsTest.requests"),
    [],
    "an invalid name must not reach the backend",
  );

  // Invalid country codes are rejected instead of being added as metadata.
  await addManualValue(browser, "input-new-dataspace-countries", "ZZZ");
  await waitFor(
    () => evaluate<boolean>(browser, `Array.from(document.querySelectorAll('[role="alert"]'))
      .some((node) => node.textContent?.includes("valid ISO alpha-2 code"))`),
    "the invalid country code to be rejected",
  );
  assert.equal(
    await evaluate<boolean>(browser, `document.querySelector('[data-testid="chips-input-new-dataspace-countries"] [data-value="ZZZ"]') !== null`),
    false,
    "an invalid country code must not become a selected chip",
  );

  // Selecting each lookup suggestion creates the exact Reservoir DDMS contract.
  await setInput(browser, "input-new-dataspace-name", "browser/new-space");
  await setInput(browser, "input-new-dataspace-legal-tags", "browser test");
  await chooseSuggestion(browser, "input-new-dataspace-legal-tags", "browser-test-tag");
  await setInput(browser, "input-new-dataspace-countries", "canada");
  await chooseSuggestion(browser, "input-new-dataspace-countries", "Canada");
  await setInput(browser, "input-new-dataspace-owners", "Browser Owners");
  const ownerLookupWidths = await evaluate<{
    menuWidth: number;
    gridWidth: number;
    inputWidth: number;
  }>(browser, `(() => {
    const menu = document.querySelector('[data-testid="suggestions-input-new-dataspace-owners"]');
    const grid = document.querySelector('[data-testid="dataspace-lookups-grid"]');
    const input = document.querySelector('[data-testid="input-new-dataspace-owners"]');
    if (!menu || !grid || !input) throw new Error("The owner lookup layout is incomplete");
    return {
      menuWidth: menu.getBoundingClientRect().width,
      gridWidth: grid.getBoundingClientRect().width,
      inputWidth: input.getBoundingClientRect().width,
    };
  })()`);
  assert.ok(
    ownerLookupWidths.menuWidth >= ownerLookupWidths.gridWidth - 4
      && ownerLookupWidths.menuWidth > ownerLookupWidths.inputWidth * 1.8,
    "the fetched owner suggestions must use the full lookup-grid width",
  );
  await chooseSuggestion(browser, "input-new-dataspace-owners", "Browser Owners");
  await setInput(browser, "input-new-dataspace-viewers", "Browser Viewers");
  await chooseSuggestion(browser, "input-new-dataspace-viewers", "Browser Viewers");
  await clickTestId(browser, "button-create-dataspace");
  await waitFor(
    () => evaluate<boolean>(browser, "window.__dsTest.requests.length === 1"),
    "the create POST to fire",
  );
  const createdRequests = await evaluate<any[]>(browser, "window.__dsTest.requests");
  assert.equal(createdRequests[0].method, "POST", "dataspace registration must use POST");
  assert.ok(
    createdRequests[0].url.endsWith("/api/osdu/rdms/dataspaces"),
    "dataspace registration must target the collection endpoint",
  );
  assert.deepEqual(createdRequests[0].payload, [{
    DataspaceId: "browser/new-space",
    Path: "browser/new-space",
    CustomData: {
      legaltags: ["browser-test-tag"],
        otherRelevantDataCountries: ["CA"],
      owners: ["data.default.owners@browser.dataservices.energy"],
      viewers: ["data.default.viewers@browser.dataservices.energy"],
      "read-only": "false",
    },
  }], "the app should send the full registration envelope and custom data arrays");
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[data-testid="dialog-new-dataspace"]') === null`),
    "the dialog to close after a successful create",
  );
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[role="combobox"]')?.textContent?.includes("browser/new-space") ?? false`),
    "the new dataspace to become selected",
  );

  // A Reservoir DDMS failure is shown in the still-open dialog.
  await clickTestId(browser, "button-new-dataspace");
  await setInput(browser, "input-new-dataspace-name", "browser/failed-space");
  await addManualValue(browser, "input-new-dataspace-legal-tags", "manual-browser-tag");
  await addManualValue(browser, "input-new-dataspace-countries", "us");
  await addManualValue(browser, "input-new-dataspace-owners", "data.manual.owners@browser.dataservices.energy");
  await clickTestId(browser, "button-create-dataspace");
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[data-testid="new-dataspace-error"]')?.textContent?.includes("invalid legal tag") ?? false`),
    "the upstream create error to be shown",
  );
  assert.equal(
    await evaluate<boolean>(browser, `document.querySelector('[data-testid="dialog-new-dataspace"]') !== null`),
    true,
    "the create dialog should remain open after an upstream error",
  );
}

async function runBrowserCheck(): Promise<void> {
  let appServer: ChildProcess | undefined;
  let chromium: ChildProcess | undefined;
  let browser: CdpClient | undefined;
  try {
    appServer = spawn("pnpm", ["--filter", "@workspace/osdu-explorer", "run", "dev"], {
      cwd: process.cwd(),
      env: { ...process.env, BASE_PATH: "/", PORT: String(APP_PORT) },
      detached: true,
      stdio: "ignore",
    });
    await waitForUrl(`${APP_URL}/reservoir-dms`, "OSDU Explorer dev server for dataspace create check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-dataspace-create-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Reservoir DDMS dataspace create browser check passed.");
  } finally {
    browser?.close();
    if (chromium?.pid) {
      try { process.kill(-chromium.pid, "SIGTERM"); } catch { chromium.kill("SIGTERM"); }
    }
    await delay(150);
    if (appServer?.pid) {
      try { process.kill(-appServer.pid, "SIGTERM"); } catch { appServer.kill("SIGTERM"); }
    }
  }
}

await runBrowserCheck();
