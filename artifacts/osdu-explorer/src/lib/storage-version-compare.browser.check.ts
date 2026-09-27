import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5190;
const DEBUG_PORT = 9600 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

declare global {
  interface Window {
    __compareTest: { versionRequests: number[] };
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

// Mock config/search plus per-version Storage records with known deltas:
//   v1: VersionMarker marker-v1, SpudDate present
//   v2: VersionMarker marker-v2, SpudDate present
//   v3: VersionMarker marker-v3, Operator added, SpudDate removed
function mockApiScript(): string {
  return `
    (() => {
      const recordId = "tenant:browser-test:master-data--Well(version-record)";
      window.__compareTest = { versionRequests: [] };
      const baseRecord = {
        id: recordId,
        kind: "osdu:wks:master-data--Well:1.0.0",
        acl: { owners: [], viewers: [] },
        legal: {},
        meta: [],
        ancestry: {},
        tags: {},
      };
      const dataFor = (version) => {
        if (version === 3) return { FacilityName: "Version demo record", VersionMarker: "marker-v3", Operator: "OpCo" };
        if (version === 2) return { FacilityName: "Version demo record", VersionMarker: "marker-v2", SpudDate: "2020-05-01" };
        return { FacilityName: "Version demo record", VersionMarker: "marker-v1", SpudDate: "2020-05-01" };
      };

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
            results: [{ id: recordId, kind: baseRecord.kind, data: { FacilityName: "Version demo record" } }],
            totalCount: 1,
          }), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "GET" && url.includes("/versions")) {
          return new Response(JSON.stringify({ recordId, versions: [1, 2, 3] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "GET" && url.includes("/api/osdu/records/")) {
          const versionSegment = new URL(url, window.location.origin).pathname.split("/").pop();
          if (versionSegment && /^[1-9][0-9]*$/.test(versionSegment)) {
            const version = Number(versionSegment);
            window.__compareTest.versionRequests.push(version);
            return new Response(JSON.stringify({ ...baseRecord, version, data: dataFor(version) }), {
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ ...baseRecord, version: 3, data: dataFor(3) }), {
            headers: { "Content-Type": "application/json" },
          });
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

// Search → open the record in the fullscreen JSON viewer (Search Service).
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
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('version-record') ?? false"),
    "the mocked search result",
  );

  await evaluate<void>(browser, browserFunction(() => {
    const row = [...document.querySelectorAll("tbody tr")].find((candidate) =>
      candidate.textContent?.includes("version-record"));
    if (!row) throw new Error("The search result row was not found");
    (row as HTMLElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('tbody tr[data-state=\"selected\"]') !== null"),
    "the result row to become selected",
  );

  await evaluate<void>(browser, browserFunction(() => {
    const open = document.querySelector('button[aria-label="Open Search Record result"]') as HTMLButtonElement | null;
    if (!open) throw new Error("The Open Search Record result button was not found");
    open.click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Record from Search Service') ?? false"),
    "the fullscreen record viewer",
  );
}

// Open the version dropdown and click "Compare versions…".
async function openCompareDialog(browser: CdpClient): Promise<void> {
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Select record version\"]') !== null"),
    "the version selector to appear",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Select record version"]') as HTMLButtonElement | null;
    if (!button) throw new Error("The version selector button was not found");
    // Radix opens on keydown; HTMLElement.click() does not synthesize it.
    button.focus();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "[...document.querySelectorAll('[role=\"menuitem\"]')].some((i) => i.getAttribute('aria-label') === 'Compare versions')"),
    "the Compare versions menu item",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')]
      .find((candidate) => candidate.getAttribute("aria-label") === "Compare versions");
    if (!item) throw new Error("The Compare versions menu item was not found");
    (item as HTMLElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "[...document.querySelectorAll('[role=\"dialog\"]')].some((d) => d.textContent?.includes('Compare versions'))"),
    "the compare dialog to open",
  );
}

async function runScenario(browser: CdpClient): Promise<void> {
  await openRecordViewer(browser);
  await openCompareDialog(browser);

  // Default diff is previous (v2) vs latest (v3): both versions are fetched.
  await waitFor(
    () => evaluate<boolean>(browser, "window.__compareTest.versionRequests.includes(2) && window.__compareTest.versionRequests.includes(3)"),
    "both default versions to be fetched",
  );

  // The changed data field and its before → after values render.
  await waitFor(
    () => evaluate<boolean>(browser, `(() => {
      const rows = [...document.querySelectorAll('[data-testid="version-change-row"]')];
      return rows.some((r) => r.textContent?.includes("data.VersionMarker") && r.textContent?.includes("marker-v2") && r.textContent?.includes("marker-v3"));
    })()`),
    "the changed data.VersionMarker row",
  );
  // The added field appears; the removed one too.
  assert.equal(
    await evaluate<boolean>(browser, `[...document.querySelectorAll('[data-testid="version-change-row"]')].some((r) => r.textContent?.includes("data.Operator") && r.textContent?.includes("OpCo"))`),
    true,
    "the added data.Operator field should be shown",
  );
  assert.equal(
    await evaluate<boolean>(browser, `[...document.querySelectorAll('[data-testid="version-change-row"]')].some((r) => r.textContent?.includes("data.SpudDate"))`),
    true,
    "the removed data.SpudDate field should be shown",
  );
  // Summary badges reflect the counts (1 added: Operator).
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('[data-testid=\"version-diff-summary\"]')?.textContent?.includes('1 added') ?? false"),
    true,
    "the summary should report one added field",
  );
  // System fields (version) are grouped separately from data changes.
  await waitFor(
    () => evaluate<boolean>(browser, "document.body.textContent?.includes('Data changes') && document.body.textContent?.includes('System fields')"),
    "the data / system change grouping",
  );

  // Switching the base version to v1 recomputes the diff.
  const before = await evaluate<number>(browser, "window.__compareTest.versionRequests.length");
  await evaluate<void>(browser, browserFunction(() => {
    const trigger = document.querySelector('button[aria-label="Select base version"]') as HTMLButtonElement | null;
    if (!trigger) throw new Error("The base version picker was not found");
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "[...document.querySelectorAll('[role=\"option\"]')].some((o) => o.textContent?.includes('v1'))"),
    "the base version options",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim().startsWith("v1"));
    if (!option) throw new Error("The v1 option was not found");
    (option as HTMLElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, `window.__compareTest.versionRequests.length > ${before} && window.__compareTest.versionRequests.includes(1)`),
    "the v1 fetch after switching the base version",
  );
  await waitFor(
    () => evaluate<boolean>(browser, `[...document.querySelectorAll('[data-testid="version-change-row"]')].some((r) => r.textContent?.includes("data.VersionMarker") && r.textContent?.includes("marker-v1"))`),
    "the recomputed diff against v1",
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
    await waitForUrl(`${APP_URL}/search`, "OSDU Explorer dev server for version compare check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-version-compare-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Storage version compare browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
