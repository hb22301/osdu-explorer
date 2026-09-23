import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5184;
const DEBUG_PORT = 9700 + (process.pid % 100);
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

// Mocks the mode endpoints so the toggle can be exercised without a backend.
// window.__modeTest.failEtp forces the POST to reject an ETP switch, matching
// the server refusing to enable ETP when the session cannot be warmed.
function mockApiScript(): string {
  return `
    (() => {
      window.__modeTest = { mode: "rest", postedModes: [], failEtp: false };
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
        if (url.endsWith("/api/osdu/rdms/mode") && method === "GET") {
          return new Response(JSON.stringify({ mode: window.__modeTest.mode }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/api/osdu/rdms/mode") && method === "POST") {
          const requested = JSON.parse((init && init.body) || "{}").mode;
          window.__modeTest.postedModes.push(requested);
          if (requested === "etp" && window.__modeTest.failEtp) {
            return new Response(JSON.stringify({ error: "Could not open an ETP session: endpoint unreachable" }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            });
          }
          window.__modeTest.mode = requested;
          return new Response(JSON.stringify({ mode: requested }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/api/osdu/rdms/dataspaces")) {
          return new Response(JSON.stringify({ dataspaces: ["browser/dataspace"] }), { headers: { "Content-Type": "application/json" } });
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

const SWITCH_SELECTOR = 'button[aria-label="Toggle Reservoir DDMS access between REST and ETP"]';

function clickSwitch(client: CdpClient): Promise<void> {
  return evaluate<void>(client, `(() => {
    const toggle = document.querySelector('${SWITCH_SELECTOR}');
    if (!toggle) throw new Error("mode switch was not found");
    toggle.click();
  })()`);
}

function switchIsChecked(client: CdpClient): Promise<boolean> {
  return evaluate<boolean>(client, `document.querySelector('${SWITCH_SELECTOR}')?.getAttribute("data-state") === "checked"`);
}

async function runScenario(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/reservoir-dms` });
  await waitFor(() => evaluate<boolean>(browser, `document.querySelector('${SWITCH_SELECTOR}') !== null`), "the mode switch to appear");

  // The session starts in REST mode, so the switch is unchecked.
  assert.equal(await switchIsChecked(browser), false, "the switch should start in REST mode");

  // Switching to ETP posts the new mode and reflects it in the switch.
  await clickSwitch(browser);
  await waitFor(() => switchIsChecked(browser), "the switch to move to ETP");
  assert.deepEqual(
    await evaluate<string[]>(browser, "window.__modeTest.postedModes"),
    ["etp"],
    "toggling on should post the etp mode once",
  );

  // Switching back posts the rest mode.
  await clickSwitch(browser);
  await waitFor(async () => !(await switchIsChecked(browser)), "the switch to move back to REST");
  assert.deepEqual(
    await evaluate<string[]>(browser, "window.__modeTest.postedModes"),
    ["etp", "rest"],
    "toggling off should post the rest mode",
  );

  // A server that refuses ETP keeps the switch in REST and surfaces the error.
  await evaluate<void>(browser, "window.__modeTest.failEtp = true; window.__modeTest.postedModes = []");
  await clickSwitch(browser);
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[role="alert"]')?.textContent?.includes("Could not open an ETP session") ?? false`),
    "the ETP failure message to appear",
  );
  assert.equal(await switchIsChecked(browser), false, "a refused ETP switch should stay in REST mode");
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
    await waitForUrl(`${APP_URL}/reservoir-dms`, "OSDU Explorer dev server for Reservoir mode toggle check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-reservoir-mode-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Reservoir DDMS mode toggle browser check passed.");
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
