import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5197;
const DEBUG_PORT = 9550 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

// A complete kind that is deliberately NOT in the mocked kinds list, so the
// KindCombobox offers it as a "Use custom" entry we can select.
const TARGET_KIND = "osdu:wks:master-data--Well:1.0.0";

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

// Mocks config, an unrelated kinds list, the target kind's schema, the lookup
// endpoints, and the create PUT so the Search-page new-record flow runs end to
// end without a live backend.
function mockApiScript(): string {
  return `
    (() => {
      const targetKind = ${JSON.stringify(TARGET_KIND)};
      window.__newRecordTest = { requests: [] };

      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const method = (init && init.method) || "GET";
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), { headers: { "Content-Type": "application/json" } });
        }
        // A kinds list that does NOT contain the target kind, so the combobox
        // offers it as a custom entry.
        if (url.includes("/api/osdu/kinds")) {
          return new Response(JSON.stringify({ kinds: ["osdu:wks:reference-data--Something:1.0.0"], cursor: null }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/osdu/entitlements/groups")) {
          return new Response(JSON.stringify({ groups: [] }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/api/osdu/legal-tags")) {
          return new Response(JSON.stringify({ legalTags: [] }), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "PUT" && url.endsWith("/api/osdu/records")) {
          window.__newRecordTest.requests.push({ method, url, body: (init && init.body) || null });
          return new Response(JSON.stringify({
            recordCount: 1,
            recordIds: ["tenant:browser-test:master-data--Well(uuid-search)"],
          }), { headers: { "Content-Type": "application/json" } });
        }
        const detail = url.match(/\\/api\\/osdu\\/schemas\\/(.+?)(?:\\?|$)/);
        if (method === "GET" && detail) {
          return new Response(JSON.stringify({
            kind: targetKind,
            status: "PUBLISHED",
            schema: { properties: { data: { properties: { FacilityName: { type: "string" } } } } },
          }), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "POST" && url.includes("/api/osdu/search")) {
          return new Response(JSON.stringify({ results: [], totalCount: 0 }), {
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
  await browser.call("Page.navigate", { url: `${APP_URL}/search` });
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('h1')?.textContent === 'Record Search'"),
    "the Record Search page",
  );

  // The prominent header "New record" button opens the dialog with a kind picker.
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[data-testid="button-open-new-record"]') !== null`),
    "the header New record button",
  );
  await evaluate<void>(browser, browserFunction(() => {
    (document.querySelector('[data-testid="button-open-new-record"]') as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[data-testid="new-record-pick-kind"]') !== null`),
    "the new-record dialog kind prompt",
  );

  // Drive the kind combobox: type the target kind and select the "Use custom" entry.
  await evaluate<void>(browser, browserFunction((kind: string) => {
    const input = document.querySelector('[data-testid="new-record-dialog"] input[type="text"]') as HTMLInputElement | null;
    if (!input) throw new Error("The kind combobox input was not found");
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
    setter?.call(input, kind);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, TARGET_KIND));
  await waitFor(
    () => evaluate<boolean>(browser, `[...document.querySelectorAll('[data-testid="new-record-dialog"] li[role="option"]')].some((li) => li.textContent?.includes("Use"))`),
    "the combobox custom-kind option",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const custom = [...document.querySelectorAll('[data-testid="new-record-dialog"] li[role="option"]')]
      .find((li) => li.textContent?.includes("Use"));
    if (!custom) throw new Error("The custom-kind option was not found");
    custom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  }));
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[data-testid="new-record-editor"]') !== null`),
    "the new-record editor to open with a seeded template",
  );

  const seeded = await evaluate<string>(browser, `document.querySelector('[data-testid="new-record-editor"]')?.value ?? ''`);
  const draft = JSON.parse(seeded) as Record<string, unknown>;
  assert.equal(draft.kind, TARGET_KIND, "the picked kind seeds the template");
  assert.equal("id" in draft, false, "the template carries no id");

  // Creating fires exactly one id-less PUT and surfaces the new record id.
  await evaluate<void>(browser, browserFunction(() => {
    const create = document.querySelector('[data-testid="button-create-new-record"]') as HTMLButtonElement | null;
    if (!create) throw new Error("The Create record button was not found");
    create.click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[data-testid="new-record-success"]') !== null`),
    "the new-record success banner",
  );

  const requests = await evaluate<{ method: string; url: string; body: string | null }[]>(
    browser,
    "window.__newRecordTest.requests",
  );
  assert.equal(requests.length, 1, "creating fires exactly one PUT to the records endpoint");
  assert.equal(requests[0].method, "PUT", "the create uses PUT");
  const body = JSON.parse(requests[0].body ?? "null");
  assert.ok(Array.isArray(body) && body.length === 1, "the request body holds exactly the new record");
  assert.equal("id" in body[0], false, "a create body carries no id so OSDU assigns one");
  assert.equal(body[0].kind, TARGET_KIND, "the create sends the picked kind");
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
    await waitForUrl(`${APP_URL}/search`, "OSDU Explorer dev server for new-record search-entry check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-storage-new-search-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Storage Service new-record search-entry browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
