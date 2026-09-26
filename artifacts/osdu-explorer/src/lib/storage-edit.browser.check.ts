import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5182;
const DEBUG_PORT = 9600 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

declare global {
  interface Window {
    __storageEditTest: {
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
      const recordId = "tenant:browser-test:master-data--Well(uuid-store)";
      const storageRecord = {
        id: recordId,
        kind: "osdu:wks:master-data--Well:1.0.0",
        version: 1,
        acl: { owners: ["data.default.owners@browser-test"], viewers: ["data.default.viewers@browser-test"] },
        legal: {},
        data: { FacilityName: "Storage editable record" },
        meta: [],
        ancestry: {},
        tags: {},
      };
      window.__storageEditTest = { requests: [] };

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
            results: [{ id: recordId, kind: storageRecord.kind, data: { FacilityName: "Storage editable record" } }],
            totalCount: 1,
          }), { headers: { "Content-Type": "application/json" } });
        }
        // Save: single PUT to the records endpoint with an array body.
        if (method === "PUT" && url.endsWith("/api/osdu/records")) {
          window.__storageEditTest.requests.push({ method, url, body: (init && init.body) || null });
          return new Response(JSON.stringify({ recordCount: 1, recordIds: [recordId] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/osdu/records/")) {
          return new Response(JSON.stringify(storageRecord), { headers: { "Content-Type": "application/json" } });
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
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('uuid-store') ?? false"),
    "the mocked search result",
  );

  await evaluate<void>(browser, browserFunction(() => {
    const row = [...document.querySelectorAll("tbody tr")].find((candidate) =>
      candidate.textContent?.includes("uuid-store"));
    if (!row) throw new Error("The search result row was not found");
    (row as HTMLElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('tbody tr[data-state=\"selected\"]') !== null"),
    "the result row to become selected",
  );

  await evaluate<void>(browser, browserFunction(() => {
    const storage = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === "Storage API");
    if (!storage) throw new Error("The Storage API lookup button was not found");
    (storage as HTMLElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Record from Storage Service') ?? false"),
    "the storage record dialog",
  );

  // The storage record viewer exposes an Edit button gated on being a storage record.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Edit record in Storage Service\"]') !== null"),
    "the storage Edit button to appear",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Edit record in Storage Service"]');
    if (!button) throw new Error("Edit button was not found");
    (button as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('textarea[aria-label=\"Record JSON editor\"]') !== null"),
    "the JSON editor to open",
  );

  const seeded = await evaluate<string>(browser, "document.querySelector('textarea[aria-label=\"Record JSON editor\"]')?.value ?? ''");
  assert.match(seeded, /uuid-store/, "the editor should be seeded with the storage record JSON");
  assert.equal(await saveEnabled(browser), true, "Save should be enabled for the valid seeded JSON");

  // Invalid JSON disables Save and shows the parse error.
  await setTextareaValue(browser, "{ not valid json");
  await waitFor(
    () => evaluate<boolean>(browser, "document.body.innerText.includes('Invalid JSON:')"),
    "the invalid-JSON message to appear",
  );
  assert.equal(await saveEnabled(browser), false, "Save should be disabled while the JSON is invalid");

  // A valid edit re-enables Save; saving fires a single PUT with the record wrapped in an array.
  const edited = JSON.stringify({
    id: "tenant:browser-test:master-data--Well(uuid-store)",
    kind: "osdu:wks:master-data--Well:1.0.0",
    version: 1,
    acl: { owners: ["data.default.owners@browser-test"], viewers: ["data.default.viewers@browser-test"] },
    legal: {},
    data: { FacilityName: "Edited in browser" },
    meta: [],
    ancestry: {},
    tags: {},
  }, null, 2);
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
    "window.__storageEditTest.requests",
  );
  assert.equal(requests.length, 1, "the save should fire exactly one PUT to the records endpoint");
  assert.equal(requests[0].method, "PUT", "the save should PUT the record");
  assert.match(requests[0].url, /\/api\/osdu\/records$/, "the save should target the storage records endpoint");
  const body = JSON.parse(requests[0].body ?? "null");
  assert.ok(Array.isArray(body), "the request body should be an array of records");
  assert.equal(body.length, 1, "the request body should contain exactly the edited record");
  assert.equal(body[0].data.FacilityName, "Edited in browser", "the save should send the edited record");
  assert.equal("meta" in body[0], false, "the save should omit response-only meta");
  assert.equal("ancestry" in body[0], false, "the save should omit response-only ancestry");
  assert.equal("tags" in body[0], false, "the save should omit response-only tags");
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
    await waitForUrl(`${APP_URL}/search`, "OSDU Explorer dev server for Storage edit check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-storage-edit-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Storage Service edit browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();