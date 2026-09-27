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
// body carries `aggregateBy` — a kind aggregation of 10 buckets so the panel
// exercises both the top-N bars and the collapsed "Other" row.
function mockApiScript(): string {
  return `
    (() => {
      window.__aggTest = { aggregateByRequests: [] };
      const buckets = [
        { key: "osdu:wks:master-data--Well:1.0.0", count: 100 },
        { key: "osdu:wks:master-data--Wellbore:1.0.0", count: 90 },
        { key: "osdu:wks:dataset--File.Generic:1.0.0", count: 80 },
        { key: "osdu:wks:work-product-component--WellLog:1.0.0", count: 70 },
        { key: "osdu:wks:master-data--Field:1.0.0", count: 60 },
        { key: "osdu:wks:master-data--GeoPoliticalEntity:1.0.0", count: 50 },
        { key: "osdu:wks:master-data--Organisation:1.0.0", count: 40 },
        { key: "osdu:wks:reference-data--UnitOfMeasure:1.0.0", count: 30 },
        { key: "osdu:wks:master-data--Basin:1.0.0", count: 20 },
        { key: "osdu:wks:work-product-component--Document:1.0.0", count: 10 },
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
            return new Response(JSON.stringify({ results: [], totalCount: 550, aggregations: buckets }), {
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({
            results: [{ id: "tenant:agg:master-data--Well(row)", kind: "osdu:wks:master-data--Well:1.0.0", data: { Name: "Row" } }],
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

  // Top-N bars render (8 of the 10 kinds), with the highest-count kind first.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelectorAll('[data-testid=\"agg-bucket\"]').length === 8"),
    "the eight top-kind bars",
  );
  assert.equal(
    await evaluate<boolean>(browser, `(() => {
      const first = document.querySelector('[data-testid="agg-bucket"]');
      return !!first && first.textContent.includes("Well") && first.textContent.includes("100");
    })()`),
    true,
    "the top bar should be Well with count 100",
  );

  // The tail collapses into an "Other" row (2 remaining kinds, count 30).
  assert.equal(
    await evaluate<boolean>(browser, `(() => {
      const other = document.querySelector('[data-testid="agg-other"]');
      return !!other && other.textContent.includes("Other (2 kinds)") && other.textContent.includes("30");
    })()`),
    true,
    "the Other row should tally the remaining 2 kinds",
  );

  // The total badge reports both the record total and the distinct kind count.
  assert.equal(
    await evaluate<boolean>(browser, `(() => {
      const total = document.querySelector('[data-testid="agg-total"]');
      return !!total && total.textContent.includes("550") && total.textContent.includes("10 kinds");
    })()`),
    true,
    "the total badge should show 550 records and 10 kinds",
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
