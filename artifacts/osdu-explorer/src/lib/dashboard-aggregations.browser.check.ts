import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5192;
const DEBUG_PORT = 9900 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

declare global {
  interface Window {
    __aggTest: { aggregateByRequests: string[] };
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

// Mock config/kinds, plain search (small result set), and — when the request
// body carries `aggregateBy` — a 70-kind aggregation that exercises the dense
// grid and the collapsed "Other" summary.
function mockApiScript(): string {
  return `
    (() => {
      window.__aggTest = { aggregateByRequests: [] };
      const buckets = [
        { key: "osdu:wks:reference-data--DataQuality:1.0.0", count: 338 },
        { key: "osdu:wks:master-data--Well:1.0.0", count: 322 },
        { key: "osdu:wks:master-data--Wellbore:1.0.0", count: 32 },
        { key: "osdu:wks:reference-data--OsduDomain:1.0.0", count: 31 },
        { key: "osdu:wks:reference-data--IndexableElement:1.0.0", count: 28 },
        { key: "osdu:wks:reference-data--OSDUJsonExtensions:1.0.0", count: 20 },
        { key: "osdu:wks:reference-data--BitReasonPulled:1.0.0", count: 19 },
        { key: "osdu:wks:reference-data--WeatherType:1.0.0", count: 16 },
        ...Array.from({ length: 62 }, (_, index) => ({
          key: "osdu:wks:reference-data--SampleKind" + String(index + 1).padStart(2, "0") + ":1.0.0",
          count: index < 29 ? 5 : 4,
        })),
      ];
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
        if (method === "POST" && url.includes("/api/osdu/search")) {
          const body = init && init.body ? JSON.parse(init.body) : {};
          if (typeof body.aggregateBy === "string") {
            window.__aggTest.aggregateByRequests.push(body.aggregateBy);
            return new Response(JSON.stringify({ results: [], totalCount: 1083, aggregations: buckets }), {
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({
            results: [{
              id: "tenant:agg:master-data--Well(row)",
              kind: "osdu:wks:master-data--Well:1.0.0",
              createTime: "2026-06-01T12:34:00.000Z",
              modifyTime: "2026-06-02T13:45:00.000Z",
              data: { Name: "Row" },
            }],
            totalCount: 1,
            aggregations: null,
          }), { headers: { "Content-Type": "application/json" } });
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

function terminateProcess(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function runScenario(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/dashboard` });

  // The aggregations panel renders.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[data-testid=\"dashboard-aggregations\"]') !== null"),
    "the dashboard aggregations panel",
  );

  // The request actually carried aggregateBy: "kind".
  await waitFor(
    () => evaluate<boolean>(browser, "window.__aggTest.aggregateByRequests.includes('kind')"),
    "an aggregateBy=kind search request",
  );

  // The compact grid renders 36 of the 70 kinds, with the highest count first.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelectorAll('[data-testid=\"agg-bucket\"]').length === 36"),
    "the 36 visible kind rows",
  );
  assert.equal(
    await evaluate<boolean>(browser, `(() => {
      const first = document.querySelector('[data-testid="agg-bucket"]');
      return !!first && first.textContent.includes("DataQuality") && first.textContent.includes("338");
    })()`),
    true,
    "the first grid item should be DataQuality with count 338",
  );

  // The remaining 34 kinds collapse into an "Other" summary (count 137).
  assert.equal(
    await evaluate<boolean>(browser, `(() => {
      const other = document.querySelector('[data-testid="agg-other"]');
      return !!other && other.textContent.includes("Other") && other.textContent.includes("34") && other.textContent.includes("137");
    })()`),
    true,
    "the Other summary should tally the remaining 34 kinds",
  );

  // The total badge reports both the record total and the distinct kind count.
  assert.equal(
    await evaluate<boolean>(browser, `(() => {
      const total = document.querySelector('[data-testid="agg-total"]');
      return !!total && total.textContent.includes("1,083") && total.textContent.includes("70 kinds");
    })()`),
    true,
    "the total badge should show 1083 records and 70 kinds",
  );

  await waitFor(
    () => evaluate<boolean>(browser, `(() => {
      const table = [...document.querySelectorAll("table")].find((candidate) =>
        [...candidate.querySelectorAll("thead th")].some((header) => header.textContent?.includes("Create Time"))
      );
      return !!table && !!table.querySelector("tbody tr td");
    })()`),
    "the dashboard table row",
  );
  const displayedTimestamps = await evaluate<{ createTime: string; modifyTime: string }>(browser, `(() => {
    const table = [...document.querySelectorAll("table")].find((candidate) =>
      [...candidate.querySelectorAll("thead th")].some((header) => header.textContent?.includes("Create Time"))
    );
    if (!table) return { createTime: "", modifyTime: "" };
    const headers = [...table.querySelectorAll("thead th")].map((header) => header.textContent ?? "");
    const createIndex = headers.findIndex((header) => header.includes("Create Time"));
    const modifyIndex = headers.findIndex((header) => header.includes("Update Time"));
    const row = table.querySelector("tbody tr");
    return {
      createTime: row?.children[createIndex]?.textContent?.trim() ?? "",
      modifyTime: row?.children[modifyIndex]?.textContent?.trim() ?? "",
    };
  })()`);
  assert.match(displayedTimestamps.createTime, /^2026-06-01/, "the table should display the record create time");
  assert.match(displayedTimestamps.modifyTime, /^2026-06-02/, "the table should display the record update time");
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
    await waitForUrl(`${APP_URL}/dashboard`, "OSDU Explorer dev server for dashboard aggregations check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-dashboard-agg-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Dashboard aggregations browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
