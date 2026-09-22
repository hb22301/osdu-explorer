import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5181;
const DEBUG_PORT = 9500 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

declare global {
  interface Window {
    __reservoirEditTest: {
      requests: { method: string; url: string; body: string | null }[];
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

function mockApiScript(): string {
  return `
    (() => {
      const dataspace = "browser test/dataspace";
      const datatype = "resqml20.obj_WellboreMarkerFrameRepresentation";
      const uuid = "uuid/edit";
      const transactionId = "tx-123";
      const record = [{
        "$type": datatype,
        Uuid: uuid,
        Citation: { Title: "Browser editable record" }
      }];
      const resourceRecord = {
        uri: "eml:///dataspace('" + dataspace + "')/" + datatype + "(" + uuid + ")",
        name: "Editable browser record",
        customData: { creator: "browser-check", created: "2026-01-01T00:00:00.000Z" },
        lastChanged: "2026-01-02T00:00:00.000Z"
      };
      window.__reservoirEditTest = { requests: [] };

      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const method = (init && init.method) || "GET";
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/api/osdu/console")) {
          return new Response(JSON.stringify({ entries: [], total: 0 }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/api/osdu/rdms/dataspaces")) {
          return new Response(JSON.stringify({ dataspaces: [dataspace] }), { headers: { "Content-Type": "application/json" } });
        }
        // Step 1: create transaction (POST .../transactions).
        if (method === "POST" && url.endsWith("/transactions")) {
          window.__reservoirEditTest.requests.push({ method, url, body: (init && init.body) || null });
          return new Response(JSON.stringify({ transactionId }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        // Step 2: update resource (PUT .../resources?transactionId=...).
        if (method === "PUT" && url.includes("/resources?")) {
          window.__reservoirEditTest.requests.push({ method, url, body: (init && init.body) || null });
          return new Response("true", { headers: { "Content-Type": "application/json" } });
        }
        // Step 3: commit transaction (PUT .../transactions/<id>).
        if (method === "PUT" && url.includes("/transactions/")) {
          window.__reservoirEditTest.requests.push({ method, url, body: (init && init.body) || null });
          return new Response("true", { headers: { "Content-Type": "application/json" } });
        }
        if (method === "GET" && url.endsWith("/resources")) {
          return new Response(JSON.stringify({ resources: [{ name: datatype, count: 1 }] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "GET" && url.endsWith("/resources/" + encodeURIComponent(datatype))) {
          return new Response(JSON.stringify({ resources: [resourceRecord] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "GET" && url.includes("/resources/" + encodeURIComponent(datatype) + "/" + encodeURIComponent(uuid))) {
          return new Response(JSON.stringify(record), { headers: { "Content-Type": "application/json" } });
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

async function setTextareaValue(browser: CdpClient, value: string): Promise<void> {
  await evaluate<void>(browser, browserFunction((next: string) => {
    const textarea = document.querySelector('textarea[aria-label="Record JSON editor"]') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error("Record JSON editor was not found");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, next);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, value));
}

async function saveEnabled(browser: CdpClient): Promise<boolean> {
  return evaluate<boolean>(browser, browserFunction(() => {
    const save = [...document.querySelectorAll('[role="dialog"] button')]
      .find((candidate) => candidate.textContent?.trim() === "Save") as HTMLButtonElement | undefined;
    return Boolean(save) && !save!.disabled;
  }));
}

async function runScenario(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/reservoir-dms` });
  await waitFor(
    () => evaluate<boolean>(browser, "([...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Fetch Resources'))"),
    "Fetch Resources button to become available",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === "Fetch Resources");
    if (!button) throw new Error("Fetch Resources button was not found");
    (button as HTMLElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('WellboreMarkerFrameRepresentation') ?? false"),
    "the mocked resource to load",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const row = [...document.querySelectorAll("table tbody tr")]
      .find((candidate) => candidate.textContent?.includes("WellboreMarkerFrameRepresentation"));
    if (!row) throw new Error("Resource row was not found");
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('uuid/edit') ?? false"),
    "the mocked record row to load",
  );
  // Double-click the record row to open the record detail viewer.
  await evaluate<void>(browser, browserFunction(() => {
    const row = [...document.querySelectorAll("table tbody tr")]
      .find((candidate) => candidate.textContent?.includes("uuid/edit"));
    if (!row) throw new Error("Record row was not found");
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }));
  // The viewer exposes an Edit button once its rdmsContext (dataspace/datatype/uuid) resolves.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Edit record in Reservoir DDMS\"]') !== null"),
    "the viewer Edit button to appear",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Edit record in Reservoir DDMS"]');
    if (!button) throw new Error("Edit button was not found");
    (button as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('textarea[aria-label=\"Record JSON editor\"]') !== null"),
    "the JSON editor to open",
  );

  const seeded = await evaluate<string>(browser, "document.querySelector('textarea[aria-label=\"Record JSON editor\"]')?.value ?? ''");
  assert.match(seeded, /uuid\/edit/, "the editor should be seeded with the record JSON");
  assert.equal(await saveEnabled(browser), true, "Save should be enabled for the valid seeded JSON");

  // Invalid JSON disables Save and shows the parse error.
  await setTextareaValue(browser, "{ not valid json");
  await waitFor(
    () => evaluate<boolean>(browser, "document.body.innerText.includes('Invalid JSON:')"),
    "the invalid-JSON message to appear",
  );
  assert.equal(
    await evaluate<boolean>(
      browser,
      "document.querySelector('[role=\"alert\"]')?.classList.contains('bg-error-surface') === true",
    ),
    true,
    "the invalid-JSON message should use the high-contrast error surface",
  );
  assert.equal(await saveEnabled(browser), false, "Save should be disabled while the JSON is invalid");

  // A valid edit re-enables Save; saving runs the 3-step transaction sequence.
  const edited = JSON.stringify([{ $type: "resqml20.obj_WellboreMarkerFrameRepresentation", Uuid: "uuid/edit", Citation: { Title: "Edited in browser" } }], null, 2);
  await setTextareaValue(browser, edited);
  await waitFor(() => saveEnabled(browser), "Save to re-enable for the valid edited JSON");
  await evaluate<void>(browser, browserFunction(() => {
    const save = [...document.querySelectorAll('[role="dialog"] button')]
      .find((candidate) => candidate.textContent?.trim() === "Save");
    if (!save) throw new Error("Save button was not found");
    (save as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('textarea[aria-label=\"Record JSON editor\"]') === null"),
    "the editor to close after a successful save",
  );

  const requests = await evaluate<{ method: string; url: string; body: string | null }[]>(
    browser,
    "window.__reservoirEditTest.requests",
  );
  assert.equal(requests.length, 3, "the save should fire exactly the three transaction steps");

  assert.equal(requests[0].method, "POST", "step 1 should POST the transaction");
  assert.match(requests[0].url, /\/transactions$/, "step 1 should hit the transactions endpoint");
  assert.deepEqual(JSON.parse(requests[0].body ?? "null"), { TimeoutPeriod: 300, Retries: 2 }, "step 1 should send the transaction options");

  assert.equal(requests[1].method, "PUT", "step 2 should PUT the resource");
  assert.match(requests[1].url, /\/resources\?transactionId=tx-123$/, "step 2 should target resources with the transaction id");
  const putBody = JSON.parse(requests[1].body ?? "null");
  assert.ok(Array.isArray(putBody), "step 2 body should be an array");
  assert.equal(putBody[0].Citation.Title, "Edited in browser", "step 2 should send the edited record");

  assert.equal(requests[2].method, "PUT", "step 3 should PUT the commit");
  assert.match(requests[2].url, /\/transactions\/tx-123$/, "step 3 should commit the transaction id");
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
    await waitForUrl(`${APP_URL}/reservoir-dms`, "OSDU Explorer dev server for Reservoir edit check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-reservoir-edit-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Reservoir DDMS edit browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
