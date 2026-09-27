import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5194;
const DEBUG_PORT = 9350 + (process.pid % 100);
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

// Mocks the dataspace listing so the metadata a store returns (timestamps and
// custom data) reaches the page. The first dataspace carries a real created
// time, an epoch-zero last-write (rendered as "—"), and custom data.
function mockApiScript(): string {
  return `
    (() => {
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
        if (url.endsWith("/api/osdu/rdms/mode")) {
          return new Response(JSON.stringify({ mode: "rest", etpAvailable: true, etpUnavailableReason: null }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/api/osdu/rdms/dataspaces") && method === "GET") {
          return new Response(JSON.stringify({ dataspaces: [
            {
              name: "meta/space",
              path: "meta/space",
              uri: "eml:///dataspace('meta/space')",
              storeCreated: "2024-05-01T10:00:00.000Z",
              storeLastWrite: "1970-01-01T00:00:00.000Z",
              customData: { legaltags: "dev1-hal-test", "read-only": "false" },
            },
          ] }), { headers: { "Content-Type": "application/json" } });
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

function textOfTestId(client: CdpClient, testId: string): Promise<string> {
  return evaluate<string>(client, `(document.querySelector('[data-testid="${testId}"]')?.textContent ?? "")`);
}

async function runScenario(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/reservoir-dms` });

  // The metadata-bearing dataspace auto-selects, so its info trigger renders.
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[data-testid="button-dataspace-metadata"]') !== null`),
    "the dataspace metadata button",
  );

  // Opening the popover reveals the preserved store metadata.
  await clickTestId(browser, "button-dataspace-metadata");
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[data-testid="dataspace-metadata-panel"]') !== null`),
    "the dataspace metadata panel",
  );

  // A real created time is formatted; the epoch-zero last-write shows as "—".
  const created = await textOfTestId(browser, "dataspace-meta-created");
  assert.ok(created.includes("2024"), `created time should be formatted, got "${created}"`);
  const lastWrite = await textOfTestId(browser, "dataspace-meta-last-write");
  assert.equal(lastWrite.trim(), "—", "an epoch-zero last-write must render as a dash");

  // Custom data key/value pairs are surfaced.
  const custom = await textOfTestId(browser, "dataspace-meta-custom");
  assert.ok(custom.includes("legaltags"), "custom data keys must be shown");
  assert.ok(custom.includes("dev1-hal-test"), "custom data values must be shown");
  assert.ok(custom.includes("read-only"), "all custom data entries must be shown");
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
    await waitForUrl(`${APP_URL}/reservoir-dms`, "OSDU Explorer dev server for dataspace metadata check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-dataspace-metadata-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Reservoir DDMS dataspace metadata browser check passed.");
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
