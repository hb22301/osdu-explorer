import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5188;
const DEBUG_PORT = 9400 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

const WELL_ID = "tenant:browser-test:master-data--Well(rel-nav)";
const WELLBORE_ID = "tenant:browser-test:master-data--Wellbore(rel-nav)";
const SEARCH_WELLBORE_ID = "tenant:browser-test:master-data--Wellbore(search-rel-nav)";

declare global {
  interface Window {
    __relTest: {
      recordRequests: string[];
      searchRequests: string[];
      fetchRequests: string[];
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

// Mock config and Storage record endpoints. The well references a wellbore via
// data.WellboreID; each record carries a marker proving which one is displayed.
function mockApiScript(): string {
  return `
    (() => {
      const wellId = ${JSON.stringify(WELL_ID)};
      const wellboreId = ${JSON.stringify(WELLBORE_ID)};
      const searchWellboreId = ${JSON.stringify(SEARCH_WELLBORE_ID)};
      const wellRecord = {
        id: wellId,
        kind: "osdu:wks:master-data--Well:1.0.0",
        version: 1,
        acl: { owners: [], viewers: [] },
        legal: {},
        data: { FacilityName: "Parent well", WellMarker: "well-record-ok", WellboreID: wellboreId + ":" },
        meta: [],
        ancestry: {},
        tags: {},
      };
      const wellboreRecord = {
        id: wellboreId,
        kind: "osdu:wks:master-data--Wellbore:1.0.0",
        version: 1,
        acl: { owners: [], viewers: [] },
        legal: {},
        data: { FacilityName: "Child wellbore", WellboreMarker: "wellbore-record-ok" },
        meta: [],
        ancestry: {},
        tags: {},
      };
      const searchWellRecord = {
        ...wellRecord,
        data: { FacilityName: "Search parent well", SearchMarker: "search-well-record-ok", WellboreID: searchWellboreId },
      };
      const searchWellboreRecord = {
        ...wellboreRecord,
        id: searchWellboreId,
        data: { FacilityName: "Search child wellbore", SearchMarker: "search-wellbore-record-ok" },
      };
      window.__relTest = { recordRequests: [], searchRequests: [], fetchRequests: [] };

      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const method = (init && init.method) || "GET";
        window.__relTest.fetchRequests.push(method + " " + url);
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/api/osdu/kinds")) {
          return new Response(JSON.stringify({ kinds: [] }), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "POST" && url.includes("/api/osdu/search")) {
          const request = JSON.parse(String(init?.body ?? "{}"));
          const query = request.query ?? "";
          window.__relTest.searchRequests.push(query);
          const result = query.includes(searchWellboreId)
            ? searchWellboreRecord
            : query.includes(wellId)
              ? searchWellRecord
              : null;
          return new Response(JSON.stringify({
            results: result ? [result] : [],
            totalCount: result ? 1 : 0,
          }), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "GET" && url.includes("/versions")) {
          return new Response(JSON.stringify({ recordId: wellId, versions: [1] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "GET" && url.includes("/api/osdu/records/")) {
          window.__relTest.recordRequests.push(url);
          const record = url.includes("Wellbore") ? wellboreRecord : wellRecord;
          return new Response(JSON.stringify(record), { headers: { "Content-Type": "application/json" } });
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

// Open the parent well via the direct-lookup input.
async function openWellRecord(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/search` });
  try {
    await waitFor(
      () => evaluate<boolean>(browser, "document.querySelector('h1')?.textContent === 'Record Search'"),
      "Record Search to render",
    );
  } catch (error) {
    console.error("Relationship navigation browser state:", await evaluate(browser, `({
      url: location.href,
      heading: document.querySelector("h1")?.textContent ?? null,
      body: document.body.innerText.slice(0, 400),
      requests: window.__relTest?.fetchRequests ?? null,
    })`));
    throw error;
  }
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
  }, WELL_ID));

  await evaluate<void>(browser, browserFunction(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === "Look up");
    if (!button) throw new Error("The Look up button was not found");
    (button as HTMLButtonElement).click();
  }));

  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('well-record-ok') ?? false"),
    "the parent well record content",
  );
}

async function openRelatedMenu(browser: CdpClient): Promise<void> {
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Related records"]') as HTMLButtonElement | null;
    if (!button) throw new Error("The Related records button was not found");
    // Radix opens the menu from keydown/pointerdown, not synthetic click().
    button.focus();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"menuitem\"]') !== null"),
    "the related-records menu",
  );
}

async function openSearchResultViewer(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/search` });
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('h1')?.textContent === 'Record Search'"),
    "Record Search page to render for a Search result",
  );
  await evaluate<void>(browser, browserFunction((query: string) => {
    const editor = document.querySelector('[role="textbox"][contenteditable="true"]') as HTMLElement | null;
    if (!editor) throw new Error("The Lucene query editor was not found");
    editor.textContent = query;
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: query }));
  }, `id:"${WELL_ID}"`));
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Run query"]') as HTMLButtonElement | null;
    if (!button) throw new Error("The Run query button was not found");
    button.click();
  }));
  let searchPageState: unknown;
  try {
    await waitFor(async () => {
      const state = await evaluate<{
        foundRow: boolean;
        body: string;
        searches: string[];
        requests: string[];
      }>(browser, `({
        foundRow: Boolean(document.querySelector("tbody tr")),
        body: document.body.innerText.slice(0, 1000),
        searches: window.__relTest.searchRequests,
        requests: window.__relTest.fetchRequests,
      })`);
      searchPageState = state;
      return state.foundRow;
    }, "the Search result row", 5_000);
  } catch (error) {
    console.error("Search result page state:", searchPageState);
    throw error;
  }
  const rowPoint = await evaluate<{ x: number; y: number } | null>(browser, `(() => {
    const row = [...document.querySelectorAll("tbody tr")].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!row) return null;
    row.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = row.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!rowPoint) throw new Error("The Search result row was not visible");
  await browser.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: rowPoint.x,
    y: rowPoint.y,
    button: "left",
    clickCount: 1,
  });
  await browser.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: rowPoint.x,
    y: rowPoint.y,
    button: "left",
    clickCount: 1,
  });
  await waitFor(
    () => evaluate<boolean>(browser, `Boolean(document.querySelector('button[aria-label="Open Search Record result"]:not(:disabled)'))`),
    "the Search Record result action to become available",
    5_000,
  );
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Open Search Record result"]') as HTMLButtonElement | null;
    if (!button || button.disabled) throw new Error("The Search Record result button was not enabled");
    button.click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body.textContent?.includes('search-well-record-ok') ?? false"),
    "the Search Service record viewer",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Related records\"]') !== null"),
    "Related records control in the Search Service record viewer",
  );
}

async function runScenario(browser: CdpClient): Promise<void> {
  await openWellRecord(browser);

  // The related-records control lists exactly the one referenced wellbore.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[data-testid=\"json-viewer-actions-toolbar\"] button[aria-label=\"Related records\"]') !== null && document.querySelector('[data-testid=\"json-viewer-actions-toolbar\"] button[aria-label=\"Back to previous record\"]') !== null"),
    "the Related and Back controls in the JSON toolbar",
  );
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('[data-testid=\"json-viewer-actions-toolbar\"] button[aria-label=\"Back to previous record\"]')?.disabled ?? false"),
    true,
    "Back should remain visible but disabled before a record has been visited",
  );
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('[data-testid=\"record-lookup-dialog-header\"] button[aria-label=\"Related records\"]') !== null"),
    false,
    "the Related control should no longer be in the record header",
  );

  await openRelatedMenu(browser);
  assert.equal(
    await evaluate<boolean>(browser, `document.querySelector('[role="menuitem"][aria-label="Open related record ${WELLBORE_ID}"]') !== null`),
    true,
    "the wellbore relationship should be listed",
  );

  // Follow the reference to the child wellbore.
  await evaluate<void>(browser, browserFunction((id: string) => {
    const item = document.querySelector(`[role="menuitem"][aria-label="Open related record ${id}"]`) as HTMLElement | null;
    if (!item) throw new Error("The wellbore relationship item was not found");
    item.click();
  }, WELLBORE_ID));

  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('wellbore-record-ok') ?? false"),
    "the child wellbore record content",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "Boolean(document.querySelector('[data-testid=\"json-viewer-actions-toolbar\"] button[aria-label=\"Related records\"]')?.disabled && !document.querySelector('[data-testid=\"json-viewer-actions-toolbar\"] button[aria-label=\"Back to previous record\"]')?.disabled)"),
    "disabled Related and enabled Back controls for the child record",
  );
  assert.equal(
    await evaluate<string>(browser, "document.querySelector('[data-testid=\"json-viewer-actions-toolbar\"] button[aria-label=\"Related records\"]')?.getAttribute('aria-description') ?? ''"),
    "0 related records",
    "Related should show a zero count when the displayed record has no references",
  );
  const recordRequestUrls = await evaluate<string[]>(browser, "window.__relTest.recordRequests");
  const requestedRecordIds = recordRequestUrls.map((url) => {
    const path = new URL(url, APP_URL).pathname;
    const rawId = path.split("/api/osdu/records/")[1]?.split("/")[0];
    if (!rawId) return null;
    try {
      return decodeURIComponent(rawId);
    } catch {
      return rawId;
    }
  });
  assert.ok(
    requestedRecordIds.includes(WELLBORE_ID),
    `navigation should fetch the wellbore by its exact ID; requests: ${recordRequestUrls.join(", ")}`,
  );

  // Step back to the parent well.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[data-testid=\"json-viewer-actions-toolbar\"] button[aria-label=\"Back to previous record\"]') !== null"),
    "the Back control in the JSON toolbar",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const back = document.querySelector('button[aria-label="Back to previous record"]') as HTMLButtonElement | null;
    if (!back) throw new Error("The Back control was not found");
    back.click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('well-record-ok') ?? false"),
    "the parent well record to return",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "Boolean(document.querySelector('[data-testid=\"json-viewer-actions-toolbar\"] button[aria-label=\"Related records\"]') && !document.querySelector('[data-testid=\"json-viewer-actions-toolbar\"] button[aria-label=\"Related records\"]')?.disabled && document.querySelector('[data-testid=\"json-viewer-actions-toolbar\"] button[aria-label=\"Back to previous record\"]')?.disabled)"),
    "enabled Related and disabled Back controls after returning to the parent",
  );

  // Search Service records keep their source when following relationships.
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Search record in Search API"]') as HTMLButtonElement | null;
    if (!button) throw new Error("The Search record lookup button was not found");
    button.click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('search-well-record-ok') ?? false"),
    "the Search Service version of the parent record",
  );
  await openRelatedMenu(browser);
  assert.equal(
    await evaluate<boolean>(browser, `document.querySelector('[role="menuitem"][aria-label="Open related record ${SEARCH_WELLBORE_ID}"]') !== null`),
    true,
    "Search relationships should be derived from the Search response",
  );
  await evaluate<void>(browser, browserFunction((id: string) => {
    const item = document.querySelector(`[role="menuitem"][aria-label="Open related record ${id}"]`) as HTMLElement | null;
    if (!item) throw new Error("The Search-related wellbore item was not found");
    item.click();
  }, SEARCH_WELLBORE_ID));
  let relatedSearchState: unknown;
  try {
    await waitFor(async () => {
    const state = await evaluate<{
      body: string;
      alerts: string[];
      searches: string[];
      requests: string[];
    }>(browser, `({
      body: document.querySelector('[role="dialog"]')?.innerText ?? "",
      alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? ""),
      searches: window.__relTest.searchRequests,
      requests: window.__relTest.fetchRequests,
    })`);
    relatedSearchState = state;
    if (state.alerts.length > 0) {
      throw new Error(`Related Search navigation failed: ${JSON.stringify(state)}`);
    }
    return state.body.includes("search-wellbore-record-ok");
    }, "the related Search Service wellbore", 5_000);
  } catch (error) {
    console.error("Related Search navigation state:", relatedSearchState);
    throw error;
  }
  assert.equal(
    await evaluate<boolean>(browser, `window.__relTest.searchRequests.includes('id:"${SEARCH_WELLBORE_ID}"')`),
    true,
    "following a Search relationship should query the Search API for the target ID",
  );
  assert.equal(
    await evaluate<boolean>(browser, `!window.__relTest.recordRequests.some((url) => decodeURIComponent(new URL(url, ${JSON.stringify(APP_URL)}).pathname).includes(${JSON.stringify(SEARCH_WELLBORE_ID)}))`),
    true,
    "following a Search relationship should not fetch the target from Storage",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const back = document.querySelector('button[aria-label="Back to previous record"]') as HTMLButtonElement | null;
    if (!back) throw new Error("The Back control was not found for Search navigation");
    back.click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('search-well-record-ok') ?? false"),
    "Back to the Search Service parent record",
  );

  await openSearchResultViewer(browser);
  await openRelatedMenu(browser);
  assert.equal(
    await evaluate<boolean>(browser, `document.querySelector('[role="menuitem"][aria-label="Open related record ${SEARCH_WELLBORE_ID}"]') !== null`),
    true,
    "the Search result viewer should expose its own related Search record",
  );
  await evaluate<void>(browser, browserFunction((id: string) => {
    const item = document.querySelector(`[role="menuitem"][aria-label="Open related record ${id}"]`) as HTMLElement | null;
    if (!item) throw new Error("The Search result relationship item was not found");
    item.click();
  }, SEARCH_WELLBORE_ID));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body.textContent?.includes('search-wellbore-record-ok') ?? false"),
    "the related record opened from a Search result",
  );
  assert.equal(
    await evaluate<boolean>(browser, `window.__relTest.searchRequests.includes('id:"${SEARCH_WELLBORE_ID}"')`),
    true,
    "the Search result viewer should also follow related records through Search",
  );
  assert.equal(
    await evaluate<boolean>(browser, `!window.__relTest.recordRequests.some((url) => decodeURIComponent(new URL(url, ${JSON.stringify(APP_URL)}).pathname).includes(${JSON.stringify(SEARCH_WELLBORE_ID)}))`),
    true,
    "the Search result viewer should not fetch related records from Storage",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const back = document.querySelector('button[aria-label="Back to previous record"]') as HTMLButtonElement | null;
    if (!back) throw new Error("The Search result Back control was not found");
    back.click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body.textContent?.includes('search-well-record-ok') ?? false"),
    "Back to the original Search result",
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
    await waitForUrl(`${APP_URL}/search`, "OSDU Explorer dev server for relationship nav check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-relationship-nav-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Search and Storage record relationship navigation browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
