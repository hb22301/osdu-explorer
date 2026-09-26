import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5189;
const DEBUG_PORT = 9500 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

const TARGET_KIND = "osdu:wks:master-data--Well:1.0.0";
const OTHER_KIND = "osdu:wks:master-data--Wellbore:1.0.0";
const RECORD_COUNT = 12_345;

declare global {
  interface Window {
    __kindsTest: {
      searchKinds: string[];
      searchBodies: Array<{ kind: string; trackTotalCount?: boolean }>;
      schemaRequests: string[];
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

// Mock config, kinds, per-kind record counts (Search) and schema fetches.
function mockApiScript(): string {
  return `
    (() => {
      const targetKind = ${JSON.stringify(TARGET_KIND)};
      const otherKind = ${JSON.stringify(OTHER_KIND)};
      window.__kindsTest = { searchKinds: [], searchBodies: [], schemaRequests: [] };

      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const method = (init && init.method) || "GET";
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/api/osdu/kinds")) {
          return new Response(JSON.stringify({ kinds: [targetKind, otherKind], cursor: null }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "POST" && url.includes("/api/osdu/search")) {
          try {
            const body = JSON.parse(init.body);
            window.__kindsTest.searchKinds.push(body.kind);
            window.__kindsTest.searchBodies.push(body);
          } catch {}
          return new Response(JSON.stringify({ results: [], totalCount: ${RECORD_COUNT} }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        // Schema detail has a path segment after /schemas/; the list endpoint does not.
        const detail = url.match(/\\/api\\/osdu\\/schemas\\/(.+?)(?:\\?|$)/);
        if (method === "GET" && detail) {
          window.__kindsTest.schemaRequests.push(decodeURIComponent(detail[1]));
          return new Response(JSON.stringify({
            kind: targetKind,
            schemaIdentity: { id: targetKind },
            status: "PUBLISHED",
            dataType: "QuantitativeAccuracyBand",
            GroupType: "reference-data",
            schema: {
              marker: "schema-view-ok",
              properties: {
                Wellbore: {
                  type: "object",
                  properties: {
                    Trajectory: {
                      type: "string",
                      description: "complete-schema-definition-visible",
                    },
                  },
                },
              },
            },
          }), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "GET" && url.includes("/api/osdu/schemas")) {
          return new Response(JSON.stringify({ schemaInfos: [], offset: 0, count: 0, totalCount: 0 }), {
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

async function runScenario(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/schemas` });
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('h1')?.textContent === 'Schema Browser'"),
    "the Schema Browser page",
  );

  // Switch to the Kinds view.
  await evaluate<void>(browser, browserFunction(() => {
    const tab = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Kinds");
    if (!tab) throw new Error("The Kinds tab was not found");
    (tab as HTMLButtonElement).click();
  }));

  // The partition's kinds render, one row each.
  await waitFor(
    () => evaluate<boolean>(browser, `[...document.querySelectorAll('[data-testid="kind-row"]')].some((r) => r.textContent?.includes(${JSON.stringify(TARGET_KIND)}))`),
    "the target kind row",
  );

  // Load the record count for the target kind (Search Service, limit:0).
  await evaluate<void>(browser, browserFunction((kind: string) => {
    const btn = document.querySelector(`button[aria-label="Load record count for ${kind}"]`) as HTMLButtonElement | null;
    if (!btn) throw new Error("The count button was not found");
    btn.click();
  }, TARGET_KIND));
  await waitFor(
    () => evaluate<boolean>(browser, `[...document.querySelectorAll('[data-testid="kind-row"]')].some((r) => r.textContent?.includes(${JSON.stringify(TARGET_KIND)}) && r.textContent?.replace(/,/g, "").includes("${RECORD_COUNT}"))`),
    "the record count to appear",
  );
  assert.equal(
    await evaluate<boolean>(browser, `window.__kindsTest.searchKinds.includes(${JSON.stringify(TARGET_KIND)})`),
    true,
    "the count should be fetched via a Search query for the exact kind",
  );
  assert.equal(
    await evaluate<boolean>(browser, `window.__kindsTest.searchBodies.some((body) => body.kind === ${JSON.stringify(TARGET_KIND)} && body.trackTotalCount === true)`),
    true,
    "the count query should request an accurate total count",
  );

  // Jump to the kind's schema definition.
  await evaluate<void>(browser, browserFunction((kind: string) => {
    const btn = document.querySelector(`button[aria-label="View schema for ${kind}"]`) as HTMLButtonElement | null;
    if (!btn) throw new Error("The View schema button was not found");
    btn.click();
  }, TARGET_KIND));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body.textContent?.includes('schema-view-ok') ?? false"),
    "the schema viewer to open with the fetched schema",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.body.textContent?.includes('QuantitativeAccuracyBand') ?? false"),
    "arbitrary top-level schema fields to be displayed",
  );
  assert.equal(
    await evaluate<boolean>(browser, `window.__kindsTest.schemaRequests.includes(${JSON.stringify(TARGET_KIND)})`),
    true,
    "the schema should be fetched for the exact kind",
  );

  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Raw view"]') as HTMLButtonElement | null;
    if (!button) throw new Error("The raw schema view button was not found");
    button.click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body.textContent?.includes('complete-schema-definition-visible') ?? false"),
    "deep schema definitions to remain available in raw view",
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
    await waitForUrl(`${APP_URL}/schemas`, "OSDU Explorer dev server for kinds browser check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-kinds-browser-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Kinds browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
