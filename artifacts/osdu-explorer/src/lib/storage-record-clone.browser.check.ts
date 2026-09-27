import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5195;
const DEBUG_PORT = 9250 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

declare global {
  interface Window {
    __storageCloneTest: {
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
      const recordId = "tenant:browser-test:master-data--Well(uuid-clone)";
      const storageRecord = {
        id: recordId,
        kind: "osdu:wks:master-data--Well:1.0.0",
        version: 7,
        createUser: "alice@browser-test",
        createTime: "2024-01-01T00:00:00.000Z",
        modifyUser: "bob@browser-test",
        modifyTime: "2024-02-01T00:00:00.000Z",
        acl: { owners: ["data.default.owners@browser-test"], viewers: ["data.default.viewers@browser-test"] },
        legal: {},
        data: { FacilityName: "Storage clonable record" },
        meta: [],
        ancestry: { parents: ["tenant:browser-test:x:1"] },
        tags: {},
      };
      window.__storageCloneTest = { requests: [] };

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
            results: [{ id: recordId, kind: storageRecord.kind, data: { FacilityName: "Storage clonable record" } }],
            totalCount: 1,
          }), { headers: { "Content-Type": "application/json" } });
        }
        // Create: PUT to the records endpoint returns a fresh, server-assigned id.
        if (method === "PUT" && url.endsWith("/api/osdu/records")) {
          window.__storageCloneTest.requests.push({ method, url, body: (init && init.body) || null });
          return new Response(JSON.stringify({
            recordCount: 1,
            recordIds: ["tenant:browser-test:master-data--Well(uuid-created)"],
          }), { headers: { "Content-Type": "application/json" } });
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
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('uuid-clone') ?? false"),
    "the mocked search result",
  );

  await evaluate<void>(browser, browserFunction(() => {
    const row = [...document.querySelectorAll("tbody tr")].find((candidate) =>
      candidate.textContent?.includes("uuid-clone"));
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

  // The Clone button appears alongside Edit for storage records.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[data-testid=\"button-clone-record\"]') !== null"),
    "the storage Clone button to appear",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('[data-testid="button-clone-record"]');
    if (!button) throw new Error("Clone button was not found");
    (button as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('textarea[aria-label=\"Record JSON editor\"]') !== null"),
    "the clone editor to open",
  );

  // The clone dialog seeds the record with the server-managed identity fields
  // removed, so a PUT creates a new record rather than a new version.
  const seeded = await evaluate<string>(browser, "document.querySelector('textarea[aria-label=\"Record JSON editor\"]')?.value ?? ''");
  const cloneDraft = JSON.parse(seeded) as Record<string, unknown>;
  for (const field of ["id", "version", "createUser", "createTime", "modifyUser", "modifyTime", "ancestry"]) {
    assert.equal(field in cloneDraft, false, `the clone draft must not carry ${field}`);
  }
  assert.equal(cloneDraft.kind, "osdu:wks:master-data--Well:1.0.0", "the clone keeps the kind");
  assert.equal((cloneDraft.data as { FacilityName?: string }).FacilityName, "Storage clonable record", "the clone keeps the payload");

  // The dialog reads as a create, not an edit.
  const dialogText = await evaluate<string>(browser, "document.querySelector('[role=\"dialog\"], .absolute.inset-0')?.textContent ?? document.body.innerText");
  assert.match(dialogText, /Clone Record — Storage Service/, "the dialog title should reflect clone mode");

  // Creating fires exactly one PUT with a body that carries no id.
  await evaluate<void>(browser, browserFunction(() => {
    const create = document.querySelector('[data-testid="button-save-record"]') as HTMLButtonElement | null;
    if (!create) throw new Error("Create button was not found");
    create.click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[data-testid=\"clone-success\"]') !== null"),
    "the clone success banner",
  );

  const successText = await evaluate<string>(browser, "document.querySelector('[data-testid=\"clone-success\"]')?.textContent ?? ''");
  assert.match(successText, /uuid-created/, "the success banner should show the new record id");

  const requests = await evaluate<{ method: string; url: string; body: string | null }[]>(
    browser,
    "window.__storageCloneTest.requests",
  );
  assert.equal(requests.length, 1, "the clone should fire exactly one PUT to the records endpoint");
  assert.equal(requests[0].method, "PUT", "the clone should PUT the record");
  assert.match(requests[0].url, /\/api\/osdu\/records$/, "the clone should target the storage records endpoint");
  const body = JSON.parse(requests[0].body ?? "null");
  assert.ok(Array.isArray(body), "the request body should be an array of records");
  assert.equal(body.length, 1, "the request body should contain exactly the cloned record");
  assert.equal("id" in body[0], false, "a clone create must send no id so OSDU assigns one");
  assert.equal("version" in body[0], false, "a clone create must send no version");
  assert.equal("meta" in body[0], false, "the clone should omit response-only meta");
  assert.equal("ancestry" in body[0], false, "the clone should omit response-only ancestry");
  assert.equal("tags" in body[0], false, "the clone should omit response-only tags");
  assert.equal(body[0].data.FacilityName, "Storage clonable record", "the clone should send the record payload");
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
    await waitForUrl(`${APP_URL}/search`, "OSDU Explorer dev server for Storage clone check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-storage-clone-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Storage Service clone browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
