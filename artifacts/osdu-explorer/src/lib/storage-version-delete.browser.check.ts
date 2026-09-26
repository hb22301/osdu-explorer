import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5187;
const DEBUG_PORT = 9500 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

declare global {
  interface Window {
    __versionDeleteTest: {
      deleteRequests: string[];
    };
  }
}

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

async function waitFor(
  check: () => Promise<boolean>,
  description: string,
  timeoutMs = 30_000,
): Promise<void> {
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

// Mock config, search, and Storage endpoints. Version 1 is purged once a DELETE
// arrives, so the version list drops it on refetch — proving the round-trip.
function mockApiScript(): string {
  return `
    (() => {
      const recordId = "tenant:browser-test:master-data--Well(version-delete)";
      const baseRecord = {
        id: recordId,
        kind: "osdu:wks:master-data--Well:1.0.0",
        version: 3,
        acl: { owners: [], viewers: [] },
        legal: {},
        data: { FacilityName: "Version delete demo", VersionMarker: "marker-v3" },
        meta: [],
        ancestry: {},
        tags: {},
      };
      window.__versionDeleteTest = { deleteRequests: [] };

      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const method = (init && init.method) || "GET";
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/api/osdu/kinds")) {
          return new Response(JSON.stringify({ kinds: [] }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/api/osdu/search")) {
          return new Response(JSON.stringify({
            results: [{ id: recordId, kind: baseRecord.kind, data: { FacilityName: "Version delete demo" } }],
            totalCount: 1,
          }), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "DELETE" && url.includes("/versions")) {
          const match = url.match(/[?&]versionIds=([^&]+)/);
          window.__versionDeleteTest.deleteRequests.push(match ? decodeURIComponent(match[1]) : "");
          return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "GET" && url.includes("/versions")) {
          // Version 1 disappears after it has been purged.
          const versions = window.__versionDeleteTest.deleteRequests.length ? [2, 3] : [1, 2, 3];
          return new Response(JSON.stringify({ recordId, versions }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "GET" && url.includes("/api/osdu/records/")) {
          return new Response(JSON.stringify(baseRecord), { headers: { "Content-Type": "application/json" } });
        }
        return realFetch(input, init);
      };
    })();
  `;
}

async function evaluate<T>(client: CdpClient, expression: string): Promise<T> {
  const response = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const result = response.result as { value?: T; description?: string; type?: string } | undefined;
  if (!result) throw new Error("Browser evaluation failed: no result");
  if (result.type === "undefined") return undefined as T;
  if (!("value" in result)) throw new Error(`Browser evaluation failed: ${result.description ?? "no value"}`);
  return result.value as T;
}

function browserFunction(fn: (...args: any[]) => unknown, ...args: unknown[]): string {
  return `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(",")})`;
}

function terminateProcess(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

// Search → open the record in the fullscreen JSON viewer where the version
// selector (and its per-version delete control) lives.
async function openRecordViewer(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/search` });
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('h1')?.textContent === 'Record Search'"),
    "Record Search to render",
  );

  await evaluate<void>(browser, browserFunction(() => {
    const input = document.querySelector("form input") as HTMLInputElement | null;
    if (!input) throw new Error("Lucene query input was not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Lucene query input setter was not found");
    setter.call(input, "*:*");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.form?.requestSubmit();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('version-delete') ?? false"),
    "the mocked search result",
  );

  await evaluate<void>(browser, browserFunction(() => {
    const row = [...document.querySelectorAll("tbody tr")].find((candidate) =>
      candidate.textContent?.includes("version-delete"));
    if (!row) throw new Error("The search result row was not found");
    (row as HTMLElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('tbody tr[data-state=\"selected\"]') !== null"),
    "the result row to become selected",
  );

  await evaluate<void>(browser, browserFunction(() => {
    const open = document.querySelector('button[aria-label="Open Search API result"]') as HTMLButtonElement | null;
    if (!open) throw new Error("The Open Search API result button was not found");
    open.click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Record from Search Service') ?? false"),
    "the fullscreen record viewer",
  );
}

async function openVersionMenu(browser: CdpClient): Promise<void> {
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Select record version"]') as HTMLButtonElement | null;
    if (!button) throw new Error("The version selector button was not found");
    // Radix opens the menu from keydown/pointerdown, not synthetic click().
    button.focus();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "[...document.querySelectorAll('[role=\"menuitem\"]')].some((item) => item.textContent?.includes('v1')) ?? false"),
    "the version menu items",
  );
}

async function runScenario(browser: CdpClient): Promise<void> {
  await openRecordViewer(browser);

  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Select record version\"]') !== null"),
    "the version selector to appear",
  );

  // Open the menu; the latest version (v3) must NOT offer a delete control.
  await openVersionMenu(browser);
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Delete version 3\"]') !== null"),
    false,
    "the latest version must not be deletable",
  );
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Delete version 1\"]') !== null"),
    true,
    "older versions should expose a delete control",
  );

  // Click the trash control for version 1 → the confirm dialog opens.
  await evaluate<void>(browser, browserFunction(() => {
    const trash = document.querySelector('button[aria-label="Delete version 1"]') as HTMLButtonElement | null;
    if (!trash) throw new Error("The delete-version-1 button was not found");
    trash.click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"alertdialog\"]')?.textContent?.includes('Delete version 1') ?? false"),
    "the delete confirmation dialog",
  );

  // Confirm the purge.
  await evaluate<void>(browser, browserFunction(() => {
    const action = [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((candidate) => candidate.textContent?.trim().startsWith("Delete version"));
    if (!action) throw new Error("The confirm delete button was not found");
    (action as HTMLButtonElement).click();
  }));

  // The DELETE fires with versionIds=1, and the refetched list drops v1.
  await waitFor(
    () => evaluate<boolean>(browser, "window.__versionDeleteTest.deleteRequests.includes('1')"),
    "the version 1 delete request to fire",
  );
  await openVersionMenu(browser);
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Delete version 1\"]') !== null"),
    false,
    "version 1 should be gone from the picker after purge",
  );
  assert.equal(
    await evaluate<number>(browser, "document.querySelectorAll('[role=\"menuitem\"]').length"),
    2,
    "only the two remaining versions should be listed",
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
    await waitForUrl(`${APP_URL}/search`, "OSDU Explorer dev server for version delete check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-version-delete-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Storage Service version delete browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
