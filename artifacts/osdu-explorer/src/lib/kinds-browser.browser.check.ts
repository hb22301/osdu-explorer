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
const SCHEMA_TEST_ROWS = [
  {
    kind: TARGET_KIND,
    status: "PUBLISHED",
    scope: "SHARED",
    dateCreated: "2025-03-27T05:42:00Z",
    createdBy: "ServiceAdminUser",
    dateUpdated: null,
  },
  {
    kind: OTHER_KIND,
    status: "PUBLISHED",
    scope: "SHARED",
    dateCreated: "2025-03-28T08:15:00Z",
    createdBy: "Data Steward",
    dateUpdated: "2025-04-02T13:30:00Z",
  },
  {
    kind: "example:well:Inspection:2.0.0",
    status: "DEPRECATED",
    scope: "PRIVATE",
    dateCreated: "2025-04-10T10:00:00Z",
    createdBy: "Registry Admin",
    dateUpdated: null,
  },
];

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
          return new Response(JSON.stringify({
            schemaInfos: ${JSON.stringify(SCHEMA_TEST_ROWS)},
            offset: 0,
            count: ${SCHEMA_TEST_ROWS.length},
            totalCount: ${SCHEMA_TEST_ROWS.length},
          }), {
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

async function setKindsFilter(browser: CdpClient, value: string): Promise<void> {
  await evaluate<void>(browser, browserFunction((nextValue: string) => {
    const input = document.querySelector('input[aria-label="Search all table fields"]') as HTMLInputElement | null;
    if (!input) throw new Error("The table filter input was not found");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setValue) throw new Error("The native input value setter was not found");
    setValue.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value));
}

async function clearKindsFilter(browser: CdpClient): Promise<void> {
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Clear kinds filter"]') as HTMLButtonElement | null;
    if (!button) throw new Error("The clear filter button was not found");
    button.click();
  }));
}

async function setSchemaTableFilter(browser: CdpClient, value: string): Promise<void> {
  await evaluate<void>(browser, browserFunction((nextValue: string) => {
    const input = document.querySelector('input[aria-label="Filter schema table"]') as HTMLInputElement | null;
    if (!input) throw new Error("The schema table filter input was not found");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setValue) throw new Error("The native input value setter was not found");
    setValue.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value));
}

async function clearSchemaTableFilter(browser: CdpClient): Promise<void> {
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Clear schema table filter"]') as HTMLButtonElement | null;
    if (!button) throw new Error("The clear schema filter button was not found");
    button.click();
  }));
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

  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelectorAll('[data-testid="schema-row"]').length === ${SCHEMA_TEST_ROWS.length}`),
    "the schema table rows",
  );
  await setSchemaTableFilter(browser, "data steward");
  await waitFor(
    () => evaluate<boolean>(browser, `(() => {
      const rows = [...document.querySelectorAll('[data-testid="schema-row"]')];
      return rows.length === 1 && rows[0].textContent?.includes(${JSON.stringify(OTHER_KIND)});
    })()`),
    "the schema table filter to match a creator name",
  );
  assert.equal(
    await evaluate<boolean>(browser, "document.body.textContent?.includes('Showing 1 of 3 on this page (3 total)') ?? false"),
    true,
    "the schema filter should show its matching row count",
  );
  await clearSchemaTableFilter(browser);
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelectorAll('[data-testid="schema-row"]').length === ${SCHEMA_TEST_ROWS.length}`),
    "the schema table clear button to restore all rows",
  );
  await setSchemaTableFilter(browser, "no-such-schema");
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelectorAll('[data-testid=\"schema-row\"]').length === 0 && document.body.textContent?.includes('No rows match the current filter')"),
    "the schema table to show a no-matches state",
  );
  await clearSchemaTableFilter(browser);
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelectorAll('[data-testid="schema-row"]').length === ${SCHEMA_TEST_ROWS.length}`),
    "the schema table clear button to restore rows after no matches",
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

  // The same search box should match a loaded value in the Records column.
  await setKindsFilter(browser, RECORD_COUNT.toLocaleString());
  await waitFor(
    () => evaluate<boolean>(browser, `(() => {
      const rows = [...document.querySelectorAll('[data-testid="kind-row"]')];
      return rows.length === 1 && rows[0].textContent?.includes(${JSON.stringify(TARGET_KIND)});
    })()`),
    "the table search to match the formatted record count",
  );
  assert.equal(
    await evaluate<boolean>(browser, "document.body.textContent?.includes('Showing 1 of 2 kinds') ?? false"),
    true,
    "the filtered result count should be shown",
  );

  await clearKindsFilter(browser);
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelectorAll('[data-testid="kind-row"]').length === 2`),
    "the clear filter button to restore all kinds",
  );

  await setKindsFilter(browser, "Wellbore");
  await waitFor(
    () => evaluate<boolean>(browser, `(() => {
      const rows = [...document.querySelectorAll('[data-testid="kind-row"]')];
      return rows.length === 1 && rows[0].textContent?.includes(${JSON.stringify(OTHER_KIND)});
    })()`),
    "the table filter to match a kind name",
  );

  await setKindsFilter(browser, "no-such-kind");
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelectorAll('[data-testid="kind-row"]').length === 0 && document.body.textContent?.includes('No rows match the current filters')`),
    "the table to show a no-matches state",
  );
  await clearKindsFilter(browser);
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelectorAll('[data-testid="kind-row"]').length === 2`),
    "the clear filter button to restore rows after a no-matches state",
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
