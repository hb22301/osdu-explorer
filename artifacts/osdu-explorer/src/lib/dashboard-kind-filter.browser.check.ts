import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5179;
const DEBUG_PORT = 9300 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

interface CdpMessage {
  id?: number;
  method?: string;
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

      if (message.error) {
        request.reject(new Error(message.error.message));
      } else {
        request.resolve(message.result ?? {});
      }
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
  if (!target?.webSocketDebuggerUrl) {
    throw new Error("Chrome did not expose a page target");
  }
  return target;
}

function mockApiScript(): string {
  return `
    (() => {
      const rows = [
        ...Array.from({ length: 1000 }, (_, index) => ({
          id: "record-a-" + (index + 1),
          kind: "type-a",
          data: {
            Name: "First server page " + (index + 1),
            createTime: "2026-01-01T00:00:00.000Z"
          }
        })),
        ...Array.from({ length: 51 }, (_, index) => ({
          id: "record-b-" + (index + 1),
          kind: "type-b",
          data: {
            Name: "Later server page " + (index + 1),
            createTime: "2026-01-01T00:00:00.000Z"
          }
        }))
      ];
      const calls = [];
      const pendingLaterPageResolvers = [];
      const testState = {
        calls,
        laterPageFailures: 0,
        delayedLaterPages: 2,
        releaseNextLaterPage() {
          pendingLaterPageResolvers.shift()?.();
        },
      };
      window.__dashboardKindFilterTest = testState;
      const realFetch = window.fetch.bind(window);

      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/api/osdu/kinds")) {
          return new Response(JSON.stringify({ kinds: ["type-a", "type-b"] }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/osdu/schemas")) {
          return new Response(JSON.stringify({ schemas: [], total: 0 }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/osdu/console")) {
          return new Response(JSON.stringify({ entries: [], total: 0 }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/osdu/search")) {
          const bodyText = init?.body
            ?? (input instanceof Request ? await input.clone().text() : "");
          const body = JSON.parse(String(bodyText));
          calls.push({ limit: body.limit, offset: body.offset });
          if (
            body.limit === 1000 &&
            body.offset === 1000
          ) {
            if (testState.delayedLaterPages > 0) {
              testState.delayedLaterPages -= 1;
              await new Promise((resolve) => pendingLaterPageResolvers.push(resolve));
            }
          }
          if (
            body.limit === 1000 &&
            body.offset === 1000 &&
            testState.laterPageFailures === 0
          ) {
            testState.laterPageFailures += 1;
            return new Response(JSON.stringify({ message: "Later page unavailable" }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            });
          }
          const results = rows.slice(body.offset, body.offset + body.limit);
          return new Response(JSON.stringify({ results, totalCount: rows.length }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        return realFetch(input, init);
      };
    })();
  `;
}

function cancelKindScanMockApiScript(): string {
  return `
    (() => {
      const rows = [
        ...Array.from({ length: 1000 }, (_, index) => ({
          id: "cancel-a-" + (index + 1),
          kind: "type-a",
          data: {
            Name: "Regular dashboard row " + (index + 1),
            createTime: "2026-01-01T00:00:00.000Z"
          }
        })),
        ...Array.from({ length: 51 }, (_, index) => ({
          id: "cancel-b-" + (index + 1),
          kind: "type-b",
          data: {
            Name: "Partial Kind page row " + (index + 1),
            createTime: "2026-01-01T00:00:00.000Z"
          }
        }))
      ];
      const calls = [];
      let releaseDelayedLaterPage;
      let settleDelayedLaterPage;
      const delayedLaterPage = new Promise((resolve, reject) => {
        releaseDelayedLaterPage = () => resolve();
        settleDelayedLaterPage = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      });
      const testState = {
        calls,
        delayedLaterPageStarted: false,
        delayedLaterPageSettled: false,
        laterPageAbortObserved: false,
        releaseDelayedLaterPage() {
          releaseDelayedLaterPage?.();
        },
      };
      window.__dashboardKindFilterTest = testState;
      const realFetch = window.fetch.bind(window);

      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/api/osdu/kinds")) {
          return new Response(JSON.stringify({ kinds: ["type-a", "type-b"] }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/osdu/schemas")) {
          return new Response(JSON.stringify({ schemas: [], total: 0 }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/osdu/console")) {
          return new Response(JSON.stringify({ entries: [], total: 0 }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/osdu/search")) {
          const bodyText = init?.body
            ?? (input instanceof Request ? await input.clone().text() : "");
          const body = JSON.parse(String(bodyText));
          calls.push({ limit: body.limit, offset: body.offset });
          if (body.limit === 1000 && body.offset === 1000) {
            testState.delayedLaterPageStarted = true;
            const signal = init?.signal;
            if (signal?.addEventListener) {
              signal.addEventListener("abort", () => {
                testState.laterPageAbortObserved = true;
                testState.delayedLaterPageSettled = true;
                settleDelayedLaterPage?.();
              }, { once: true });
            }
            await delayedLaterPage;
            testState.delayedLaterPageSettled = true;
          }
          const results = rows.slice(body.offset, body.offset + body.limit);
          return new Response(JSON.stringify({ results, totalCount: rows.length }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        return realFetch(input, init);
      };
    })();
  `;
}

function staleRefreshMockApiScript(): string {
  return `
    (() => {
      const initialRows = [
        ...Array.from({ length: 1000 }, (_, index) => ({
          id: "initial-a-" + (index + 1),
          kind: "type-a",
          data: {
            Name: "Initial A " + (index + 1),
            createTime: "2026-01-01T00:00:00.000Z"
          }
        })),
        ...Array.from({ length: 51 }, (_, index) => ({
          id: "initial-b-" + (index + 1),
          kind: "type-b",
          data: {
            Name: "Initial B " + (index + 1),
            createTime: "2026-01-01T00:00:00.000Z"
          }
        }))
      ];
      const refreshedRows = [
        ...Array.from({ length: 1000 }, (_, index) => ({
          id: "refreshed-a-" + (index + 1),
          kind: "type-a",
          data: {
            Name: "Refreshed A " + (index + 1),
            createTime: "2026-01-01T00:00:00.000Z"
          }
        })),
        ...Array.from({ length: 21 }, (_, index) => ({
          id: "refreshed-b-" + (index + 1),
          kind: "type-b",
          data: {
            Name: "Refreshed B " + (index + 1),
            createTime: "2026-01-01T00:00:00.000Z"
          }
        })),
        {
          id: "refreshed-c-1",
          kind: "type-c",
          data: {
            Name: "Refreshed C 1",
            createTime: "2026-01-01T00:00:00.000Z"
          }
        }
      ];
      const calls = [];
      const testState = {
        calls,
        kindScans: 0,
        refreshLaterPageFailures: 0,
      };
      window.__dashboardKindFilterTest = testState;
      const realFetch = window.fetch.bind(window);

      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/api/osdu/kinds")) {
          return new Response(JSON.stringify({ kinds: ["type-a", "type-b", "type-c"] }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/osdu/schemas")) {
          return new Response(JSON.stringify({ schemas: [], total: 0 }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/osdu/console")) {
          return new Response(JSON.stringify({ entries: [], total: 0 }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/osdu/search")) {
          const bodyText = init?.body
            ?? (input instanceof Request ? await input.clone().text() : "");
          const body = JSON.parse(String(bodyText));
          calls.push({ limit: body.limit, offset: body.offset });
          const isKindPage = body.limit === 1000;
          if (isKindPage && body.offset === 0) {
            testState.kindScans += 1;
          }
          if (
            isKindPage &&
            body.offset === 1000 &&
            testState.kindScans === 2 &&
            testState.refreshLaterPageFailures === 0
          ) {
            testState.refreshLaterPageFailures += 1;
            return new Response(JSON.stringify({ message: "Later refresh page unavailable" }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            });
          }
          const rows = isKindPage && testState.kindScans >= 2
            ? refreshedRows
            : initialRows;
          return new Response(JSON.stringify({
            results: rows.slice(body.offset, body.offset + body.limit),
            totalCount: rows.length
          }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        return realFetch(input, init);
      };
    })();
  `;
}

function dashboardTimestampMockApiScript(): string {
  return `
    (() => {
      const rows = [
        {
          id: "create-new",
          kind: "type-a",
          data: {
            Name: "Create newest",
            createTime: "2026-09-04T00:00:00.000Z",
            modifyTime: "2026-09-01T00:00:00.000Z"
          }
        },
        {
          id: "modify-new",
          kind: "type-a",
          data: {
            Name: "Modify newest",
            createTime: "2026-09-02T00:00:00.000Z",
            modifyTime: "2026-09-04T00:00:00.000Z"
          }
        },
        {
          id: "middle",
          kind: "type-a",
          data: {
            Name: "Middle timestamp",
            createTime: "2026-09-03T00:00:00.000Z",
            modifyTime: "2026-09-03T00:00:00.000Z"
          }
        }
      ];
      const calls = [];
      window.__dashboardTimestampTest = { calls };
      const realFetch = window.fetch.bind(window);

      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/api/osdu/kinds")) {
          return new Response(JSON.stringify({ kinds: ["type-a"] }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (
          url.includes("/api/osdu/config") ||
          url.includes("/api/osdu/schemas") ||
          url.includes("/api/osdu/console")
        ) {
          return new Response(JSON.stringify(
            url.includes("/api/osdu/schemas")
              ? { schemas: [], total: 0 }
              : url.includes("/api/osdu/console")
                ? { entries: [], total: 0 }
                : { configured: true }
          ), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/osdu/search")) {
          const bodyText = init?.body
            ?? (input instanceof Request ? await input.clone().text() : "");
          const body = JSON.parse(String(bodyText));
          calls.push({
            kind: body.kind,
            query: body.query,
            limit: body.limit,
            offset: body.offset,
            sort: body.sort,
          });
          return new Response(JSON.stringify({ results: rows, totalCount: rows.length }), {
            headers: { "Content-Type": "application/json" }
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
  if (!result) {
    throw new Error("Browser evaluation failed: no result");
  }
  if (result.type === "undefined") return undefined as T;
  if (!("value" in result)) {
    throw new Error(`Browser evaluation failed: ${result.description ?? "no value"}`);
  }
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

async function chooseDashboardSelect(
  browser: CdpClient,
  triggerId: string,
  optionText: string,
): Promise<void> {
  await evaluate<void>(browser, browserFunction((id) => {
    const trigger = document.getElementById(id);
    if (!trigger) throw new Error("Dashboard select trigger was not found");
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    (trigger as HTMLElement).click();
  }, triggerId));
  await waitFor(
    () => evaluate<boolean>(browser, browserFunction((expected) => {
      return [...document.querySelectorAll('[role="option"]')]
        .some((option) => option.textContent?.trim() === expected);
    }, optionText)),
    `${optionText} dashboard option to open`,
  );
  await evaluate<void>(browser, browserFunction((expected) => {
    const option = [...document.querySelectorAll('[role="option"]')]
      .find((candidate) => candidate.textContent?.trim() === expected);
    if (!option) throw new Error(`${expected} dashboard option was not found`);
    (option as HTMLElement).click();
  }, optionText));
}

async function setDashboardWindowValue(browser: CdpClient, value: number): Promise<void> {
  await evaluate<void>(browser, browserFunction((nextValue) => {
    const input = document.querySelector("#dashboard-window") as HTMLInputElement | null;
    if (!input) throw new Error("Dashboard window input was not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Dashboard window input setter was not found");
    setter.call(input, String(nextValue));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value));
}

async function runDashboardTimestampBrowserCheck(): Promise<void> {
  let appServer: ChildProcess | undefined;
  let chromium: ChildProcess | undefined;
  let browser: CdpClient | undefined;

  const units = [
    { value: "seconds", label: "Seconds", suffix: "s" },
    { value: "minutes", label: "Minutes", suffix: "m" },
    { value: "hours", label: "Hours", suffix: "h" },
    { value: "days", label: "Days", suffix: "d" },
  ] as const;
  const modes = [
    { value: "createTime", label: "Create Time", field: "createTime", firstRow: "Create newest" },
    { value: "modifyTime", label: "Update Time", field: "modifyTime", firstRow: "Modify newest" },
  ] as const;

  try {
    appServer = spawn("pnpm", ["--filter", "@workspace/osdu-explorer", "run", "dev"], {
      cwd: process.cwd(),
      env: { ...process.env, BASE_PATH: "/", PORT: String(APP_PORT) },
      detached: true,
      stdio: "ignore",
    });

    await waitForUrl(`${APP_URL}/dashboard`, "OSDU Explorer dev server for timestamp check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-dashboard-timestamp-${process.pid}`,
      "about:blank",
    ], {
      detached: true,
      stdio: "ignore",
    });

    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "headless Chromium for timestamp check");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: dashboardTimestampMockApiScript() });
    await browser.call("Page.navigate", { url: `${APP_URL}/dashboard` });

    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('h1')?.textContent === 'Dashboard'"),
      "Dashboard to render for timestamp check",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('#dashboard-sort-mode')?.textContent?.trim() === 'Create Time'"),
      "Create Time to remain the default dashboard timestamp",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, "window.__dashboardTimestampTest.calls.length >= 2"),
      "the initial dashboard and Kind requests",
    );

    for (const mode of modes) {
      await chooseDashboardSelect(browser, "dashboard-sort-mode", mode.label);

      for (const unit of units) {
        await chooseDashboardSelect(browser, "dashboard-window-unit", unit.label);
        await setDashboardWindowValue(browser, 2);

        const previousCallCount = await evaluate<number>(
          browser,
          "window.__dashboardTimestampTest.calls.length",
        );
        await evaluate<void>(browser, browserFunction(() => {
          const refresh = [...document.querySelectorAll("button")]
            .find((candidate) => candidate.textContent?.trim() === "Refresh");
          if (!refresh) throw new Error("Dashboard Refresh button was not found");
          (refresh as HTMLElement).click();
        }));
        await waitFor(
          () => evaluate<boolean>(
            browser!,
            `window.__dashboardTimestampTest.calls.length > ${previousCallCount}`,
          ),
          `${mode.label} ${unit.label} dashboard refresh`,
        );
        await waitFor(
          () => evaluate<boolean>(
            browser!,
            browserFunction((expected) => document.querySelector("tbody tr")?.textContent?.includes(expected) ?? false, mode.firstRow),
          ),
          `${mode.label} rows to sort by ${mode.field}`,
        );

        const calls: Array<{
          kind: string;
          query: string;
          limit: number;
          offset: number;
          sort: { field: string[]; order: string[] };
        }> = await evaluate(browser, "window.__dashboardTimestampTest.calls.slice()");
        const dashboardCalls: typeof calls = calls.filter((call) => call.kind === "*:*:*:*");
        const latestCall: (typeof calls)[number] | undefined = dashboardCalls.at(-1);
        assert.ok(latestCall, `a ${mode.label} ${unit.label} dashboard request should be recorded`);
        assert.equal(
          latestCall.query,
          `${mode.field}:[now-2${unit.suffix} TO now]`,
          `${mode.label} ${unit.label} should filter only by ${mode.field}`,
        );
        assert.deepEqual(
          latestCall.sort,
          { field: [mode.field], order: ["desc"] },
          `${mode.label} ${unit.label} should sort only by ${mode.field}`,
        );
        assert.equal(
          latestCall.query.includes(mode.field === "createTime" ? "modifyTime" : "createTime"),
          false,
          `${mode.label} ${unit.label} query should not mention the other timestamp`,
        );
        assert.deepEqual(
          [...new Set(dashboardCalls.slice(-2).map((call) => call.sort.field[0]))],
          [mode.field],
          `the dashboard and Kind requests should keep using ${mode.field}`,
        );
      }
    }

    console.log("Dashboard timestamp mode browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    terminateProcess(appServer);
  }
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

    await waitForUrl(`${APP_URL}/dashboard`, "OSDU Explorer dev server");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-dashboard-kind-filter-${process.pid}`,
      "about:blank",
    ], {
      detached: true,
      stdio: "ignore",
    });

    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "headless Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await browser.call("Page.navigate", { url: `${APP_URL}/dashboard` });

    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('h1')?.textContent === 'Dashboard'"),
      "Dashboard to render",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, browserFunction(() => {
        const status = document.querySelector('[role="status"]');
        return status?.textContent?.includes("Loading Kind data: page 2 of 2")
          && status.textContent.includes("1,000 rows loaded");
      })),
      "the initial Kind scan to show the pending later page",
    );
    await evaluate<void>(browser, browserFunction(() => {
      const row = [...document.querySelectorAll("tbody tr")]
        .find((candidate) => candidate.textContent?.includes("record-a-1"));
      if (!row) throw new Error("An existing dashboard row was not found");
      (row as HTMLElement).click();
    }));
    assert.equal(
      await evaluate<boolean>(browser, browserFunction(() => [...document.querySelectorAll("tbody tr")]
        .some((row) => row.textContent?.includes("record-a-1") && row.getAttribute("data-state") === "selected"))),
      true,
      "an existing dashboard row should remain selectable during the initial Kind scan",
    );
    await evaluate<void>(browser, "window.__dashboardKindFilterTest.releaseNextLaterPage()");
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body.innerText.includes('Kind filtering is temporarily unavailable')"),
      "the failed Kind scan error state",
    );
    assert.equal(
      await evaluate<boolean>(
        browser,
        "document.body.innerText.includes('page 2 (offset 1,000)') && document.body.innerText.includes('1,000 rows loaded')",
      ),
      true,
      "the failed Kind scan should identify the page and rows already loaded",
    );
    await evaluate<void>(browser, browserFunction(() => {
      const fullScreen = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.getAttribute("aria-label") === "Full screen");
      if (!fullScreen) throw new Error("Full screen button was not found");
      fullScreen.click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, browserFunction(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return Boolean(dialog?.querySelector('[role="alert"]')?.textContent?.includes("page 2 (offset 1,000)"));
      })),
      "the failed Kind scan error state in the full-screen toolbar",
    );
    await evaluate<void>(browser, browserFunction(() => {
      const exit = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.getAttribute("aria-label") === "Exit full screen");
      if (!exit) throw new Error("Exit full screen button was not found");
      exit.click();
    }));

    const initialSummary = await evaluate<{ limit: number; offset: number }[]>(
      browser,
      "window.__dashboardKindFilterTest.calls.slice()",
    );
    assert.ok(initialSummary.some((call) => call.limit === 1000 && call.offset === 0));
    assert.ok(initialSummary.some((call) => call.limit === 1000 && call.offset === 1000));
    assert.equal(
      initialSummary.filter((call) => call.limit === 1000 && call.offset === 1000).length,
      1,
      "the later page should fail once before retrying",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const retry = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.includes("Retry Kind loading"));
      if (!retry) throw new Error("Retry Kind loading button was not found");
      retry.click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, browserFunction(() => {
        const status = document.querySelector('[role="status"]');
        return status?.textContent?.includes("Loading Kind data: page 2 of 2")
          && status.textContent.includes("1,000 rows loaded");
      })),
      "the targeted Kind retry to show the pending later page",
    );
    assert.equal(
      await evaluate<boolean>(browser, browserFunction(() => [...document.querySelectorAll("tbody tr")]
        .some((row) => row.textContent?.includes("record-a-1") && row.getAttribute("data-state") === "selected"))),
      true,
      "an existing dashboard row should remain selected during the targeted Kind retry",
    );
    await evaluate<void>(browser, "window.__dashboardKindFilterTest.releaseNextLaterPage()");
    await waitFor(
      () => evaluate<boolean>(browser!, browserFunction(() => {
        const button = [...document.querySelectorAll("button")]
          .find((candidate) => candidate.getAttribute("aria-label") === "Filter recent records by kind");
        return Boolean(button && !(button as HTMLButtonElement).disabled && button.textContent?.includes("(2)"));
      })),
      "all server pages to populate the Kind filter after retry",
    );
    assert.equal(
      await evaluate<boolean>(browser, "document.body.innerText.includes('Kind filtering is temporarily unavailable')"),
      false,
    );
    const retrySummary = await evaluate<{ limit: number; offset: number }[]>(
      browser,
      "window.__dashboardKindFilterTest.calls.slice()",
    );
    assert.equal(
      retrySummary.filter((call) => call.limit === 1000 && call.offset === 1000).length,
      2,
      "retrying should request the missing later page again",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.getAttribute("aria-label") === "Filter recent records by kind");
      if (!button) throw new Error("Kind filter button was not found");
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      button.click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, browserFunction(() => [...document.querySelectorAll('[role="menuitemcheckbox"]')]
        .some((item) => item.textContent?.includes("type-b") && item.textContent?.includes("51")))),
      "the later-page Kind and its count to appear",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const item = [...document.querySelectorAll('[role="menuitemcheckbox"]')]
        .find((candidate) => candidate.textContent?.includes("type-b") && candidate.textContent?.includes("51"));
      if (!item) throw new Error("Later-page Kind option was not found");
      item.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      (item as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body.innerText.includes('1–50 of 51')"),
      "the selected Kind records to render",
    );
    assert.equal(
      await evaluate<boolean>(browser, "document.body.innerText.includes('record-b-1')"),
      true,
    );

    await evaluate<void>(browser, browserFunction(() => {
      const next = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "Next");
      if (!next) throw new Error("Next button was not found");
      next.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      next.click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body.innerText.includes('51–51 of 51')"),
      "the later local Kind page to render",
    );
    assert.equal(
      await evaluate<boolean>(browser, "document.body.innerText.includes('record-b-51')"),
      true,
    );

    await evaluate<void>(browser, browserFunction(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.getAttribute("aria-label") === "Filter recent records by kind");
      if (!button) throw new Error("Kind filter button was not found after pagination");
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      button.click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, browserFunction(() => [...document.querySelectorAll('[role="menuitem"]')]
        .some((item) => item.textContent?.includes("Clear Kind filter")))),
      "the clear Kind filter action",
    );
    await evaluate<void>(browser, browserFunction(() => {
      const clear = [...document.querySelectorAll('[role="menuitem"]')]
        .find((candidate) => candidate.textContent?.includes("Clear Kind filter"));
      if (!clear) throw new Error("Clear Kind filter action was not found");
      clear.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      (clear as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body.innerText.includes('1–50 of 1,051')"),
      "the normal first server page after clearing",
    );
    assert.equal(
      await evaluate<boolean>(browser, "document.body.innerText.includes('record-a-1')"),
      true,
    );
    assert.equal(
      await evaluate<boolean>(browser, "document.body.innerText.includes('record-b-51')"),
      false,
    );

    const finalSummary = await evaluate<{ limit: number; offset: number }[]>(
      browser,
      "window.__dashboardKindFilterTest.calls.slice()",
    );
    const normalPageCalls = finalSummary.filter((call) => call.limit === 50);
    assert.ok(normalPageCalls.length >= 2, "clearing should request the normal page again");
    assert.equal(normalPageCalls.at(-1)?.offset, 0);
    assert.equal(
      normalPageCalls.some((call) => call.offset === 50),
      false,
      "local filtered pagination must not request a server page",
    );

    console.log("Dashboard Kind filter browser check passed.");
  } catch (error) {
    throw error;
  } finally {
    browser?.close();
    terminateProcess(chromium);
    terminateProcess(appServer);
  }
}

async function runCancelBrowserCheck(): Promise<void> {
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

    await waitForUrl(`${APP_URL}/dashboard`, "OSDU Explorer dev server");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-dashboard-kind-filter-cancel-${process.pid}`,
      "about:blank",
    ], {
      detached: true,
      stdio: "ignore",
    });

    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "headless Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", {
      source: cancelKindScanMockApiScript(),
    });
    await browser.call("Page.navigate", { url: `${APP_URL}/dashboard` });

    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('h1')?.textContent === 'Dashboard'"),
      "Dashboard to render for the cancellation check",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, browserFunction(() => {
        const status = document.querySelector('[role="status"]');
        return status?.textContent?.includes("Loading Kind data: page 2 of 2")
          && status.textContent.includes("1,000 rows loaded");
      })),
      "the Kind scan to show its pending later page",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const cancel = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.getAttribute("aria-label") === "Cancel Kind scan");
      if (!cancel) throw new Error("Cancel Kind scan button was not found");
      (cancel as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(
        browser!,
        "document.body.innerText.includes('Kind scan canceled. Regular dashboard rows remain current.')",
      ),
      "the cancellation message",
    );

    assert.equal(
      await evaluate<boolean>(browser, "document.body.innerText.includes('cancel-a-1')"),
      true,
      "regular dashboard rows should remain visible after cancellation",
    );

    const abortObserved = await evaluate<boolean>(
      browser,
      "window.__dashboardKindFilterTest.laterPageAbortObserved",
    );
    if (!abortObserved) {
      await evaluate<void>(browser, "window.__dashboardKindFilterTest.releaseDelayedLaterPage()");
      await waitFor(
        () => evaluate<boolean>(browser!, "window.__dashboardKindFilterTest.delayedLaterPageSettled"),
        "the late Kind page response to settle after cancellation",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
    await evaluate<void>(browser, browserFunction(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.getAttribute("aria-label") === "Filter recent records by kind");
      if (!button) throw new Error("Kind filter button was not found after cancellation");
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      button.click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, browserFunction(() => [...document.querySelectorAll('[role="menuitemcheckbox"]')]
        .some((item) => item.textContent?.includes("type-a")))),
      "the regular dashboard Kind option to remain available",
    );
    assert.equal(
      await evaluate<boolean>(browser, browserFunction(() => [...document.querySelectorAll('[role="menuitemcheckbox"]')]
        .some((item) => item.textContent?.includes("type-b")))),
      false,
      "partial Kind page rows must not become filter options after cancellation",
    );

    console.log("Dashboard Kind cancellation browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    terminateProcess(appServer);
  }
}

async function runStaleRefreshBrowserCheck(): Promise<void> {
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

    await waitForUrl(`${APP_URL}/dashboard`, "OSDU Explorer dev server");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-dashboard-kind-filter-stale-${process.pid}`,
      "about:blank",
    ], {
      detached: true,
      stdio: "ignore",
    });

    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "headless Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: staleRefreshMockApiScript() });
    await browser.call("Page.navigate", { url: `${APP_URL}/dashboard` });

    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('h1')?.textContent === 'Dashboard'"),
      "Dashboard to render for the stale Kind refresh check",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, browserFunction(() => {
        const button = [...document.querySelectorAll("button")]
          .find((candidate) => candidate.getAttribute("aria-label") === "Filter recent records by kind");
        return Boolean(button && !(button as HTMLButtonElement).disabled && button.textContent?.includes("(2)"));
      })),
      "the initial Kind scan to complete",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.getAttribute("aria-label") === "Filter recent records by kind");
      if (!button) throw new Error("Kind filter button was not found after the initial scan");
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      button.click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, browserFunction(() => [...document.querySelectorAll('[role="menuitemcheckbox"]')]
        .some((item) => item.textContent?.includes("type-b") && item.textContent?.includes("51")))),
      "the initial type-b Kind option",
    );
    await evaluate<void>(browser, browserFunction(() => {
      const item = [...document.querySelectorAll('[role="menuitemcheckbox"]')]
        .find((candidate) => candidate.textContent?.includes("type-b") && candidate.textContent?.includes("51"));
      if (!item) throw new Error("Initial type-b Kind option was not found");
      item.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      (item as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body.innerText.includes('1–50 of 51')"),
      "the initial selected type-b table data",
    );
    assert.equal(
      await evaluate<boolean>(browser, "document.body.innerText.includes('initial-b-1')"),
      true,
      "the initial selected Kind table should show the successful scan data",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const refresh = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "Refresh");
      if (!refresh) throw new Error("Dashboard Refresh button was not found");
      (refresh as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body.innerText.includes('Kind filters are showing the last successful scan')"),
      "the stale Kind data message after refresh failure",
    );
    assert.equal(
      await evaluate<boolean>(
        browser,
        "document.body.innerText.includes('The latest Kind scan could not be completed') && document.body.innerText.includes('Retry Kind loading')",
      ),
      true,
      "the stale state should explain the failed refresh and offer a retry",
    );
    assert.equal(
      await evaluate<boolean>(browser, browserFunction(() => {
        const button = [...document.querySelectorAll("button")]
          .find((candidate) => candidate.getAttribute("aria-label") === "Filter recent records by kind");
        return Boolean(button && !(button as HTMLButtonElement).disabled && button.textContent?.includes("(1/2)"));
      })),
      true,
      "the selected Kind filter should remain usable after a refresh failure",
    );
    assert.equal(
      await evaluate<boolean>(browser, "document.body.innerText.includes('1–50 of 51') && document.body.innerText.includes('initial-b-1')"),
      true,
      "the selected table filter should continue showing the last successful rows",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.getAttribute("aria-label") === "Filter recent records by kind");
      if (!button) throw new Error("Kind filter button was not found in the stale state");
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      button.click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, browserFunction(() => [...document.querySelectorAll('[role="menuitemcheckbox"]')]
        .some((item) => item.textContent?.includes("type-b") && item.textContent?.includes("51") && item.getAttribute("aria-checked") === "true"))),
      "the checked last successful Kind option to remain available",
    );
    await evaluate<void>(browser, "document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

    await evaluate<void>(browser, browserFunction(() => {
      const retry = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.includes("Retry Kind loading"));
      if (!retry) throw new Error("Retry Kind loading button was not found in the stale state");
      (retry as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, browserFunction(() => {
        const button = [...document.querySelectorAll("button")]
          .find((candidate) => candidate.getAttribute("aria-label") === "Filter recent records by kind");
        return Boolean(button && !(button as HTMLButtonElement).disabled && button.textContent?.includes("(1/3)"));
      })),
      "the successful Kind retry to update the options",
    );
    assert.equal(
      await evaluate<boolean>(browser, "document.body.innerText.includes('Kind filters are showing the last successful scan')"),
      false,
      "a successful retry should clear the stale Kind state",
    );
    assert.equal(
      await evaluate<boolean>(browser, "document.body.innerText.includes('1–21 of 21') && document.body.innerText.includes('refreshed-b-1')"),
      true,
      "a successful retry should update the selected table data",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.getAttribute("aria-label") === "Filter recent records by kind");
      if (!button) throw new Error("Kind filter button was not found after retry");
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      button.click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, browserFunction(() => {
        const items = [...document.querySelectorAll('[role="menuitemcheckbox"]')];
        return items.some((item) => item.textContent?.includes("type-b") && item.textContent?.includes("21"))
          && items.some((item) => item.textContent?.includes("type-c") && item.textContent?.includes("1"));
      })),
      "the refreshed Kind options and counts",
    );

    const calls = await evaluate<{ limit: number; offset: number }[]>(
      browser,
      "window.__dashboardKindFilterTest.calls.slice()",
    );
    assert.equal(
      calls.filter((call) => call.limit === 1000 && call.offset === 0).length,
      3,
      "the initial scan, failed refresh, and retry should each request the first Kind page",
    );
    assert.equal(
      calls.filter((call) => call.limit === 1000 && call.offset === 1000).length,
      3,
      "the refresh should retry the failed later Kind page",
    );

    console.log("Dashboard stale Kind refresh browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
await runCancelBrowserCheck();
await runStaleRefreshBrowserCheck();
await runDashboardTimestampBrowserCheck();