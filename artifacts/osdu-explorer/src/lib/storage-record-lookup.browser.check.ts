import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5186;
const DEBUG_PORT = 9600 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

declare global {
  interface Window {
    __lookupTest: {
      recordRequests: string[];
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

// Mock config and Storage record endpoints. The returned record carries a
// distinctive marker so the viewer content proves the lookup fetched it.
function mockApiScript(): string {
  return `
    (() => {
      const recordId = "tenant:browser-test:master-data--Well(lookup-by-id)";
      const storageRecord = {
        id: recordId,
        kind: "osdu:wks:master-data--Well:1.0.0",
        version: 1,
        acl: { owners: [], viewers: [] },
        legal: {},
        data: { FacilityName: "Looked up by ID", LookupMarker: "direct-lookup-ok" },
        meta: [],
        ancestry: {},
        tags: {},
      };
      window.__lookupTest = { recordRequests: [] };

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
        if (method === "GET" && url.includes("/versions")) {
          return new Response(JSON.stringify({ recordId, versions: [1] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "GET" && url.includes("/api/osdu/records/")) {
          window.__lookupTest.recordRequests.push(url);
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
  const recordId = "tenant:browser-test:master-data--Well(lookup-by-id)";

  await browser.call("Page.navigate", { url: `${APP_URL}/search` });
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('h1')?.textContent === 'Record Search'"),
    "Record Search to render",
  );

  // The direct-lookup input is available before running any search.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('input[aria-label=\"Storage record ID\"]') !== null"),
    "the Storage record ID input",
  );

  await evaluate<void>(browser, browserFunction((id: string) => {
    const input = document.querySelector('input[aria-label="Storage record ID"]') as HTMLInputElement | null;
    if (!input) throw new Error("The Storage record ID input was not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("The input value setter was not found");
    setter.call(input, id);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, recordId));

  await evaluate<void>(browser, browserFunction(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === "Look up");
    if (!button) throw new Error("The Look up button was not found");
    (button as HTMLButtonElement).click();
  }));

  // The Storage Service viewer opens and shows the fetched record.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Record from Storage Service') ?? false"),
    "the Storage record viewer",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('direct-lookup-ok') ?? false"),
    "the looked-up record content",
  );
  assert.equal(
    await evaluate<boolean>(browser, `window.__lookupTest.recordRequests.some((url) => url.includes(encodeURIComponent(${JSON.stringify(recordId)})))`),
    true,
    "the lookup should request the record by its exact ID",
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
    await waitForUrl(`${APP_URL}/search`, "OSDU Explorer dev server for record lookup check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-record-lookup-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Storage Service record lookup browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
