import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5196;
const DEBUG_PORT = 9450 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

const TARGET_KIND = "osdu:wks:master-data--Well:1.0.0";

declare global {
  interface Window {
    __newRecordTest: {
      requests: { method: string; url: string; body: string | null }[];
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

// Mocks the kinds list, the target kind's schema (inline data fields plus one
// $ref-only field), and the create PUT so the new-record flow runs end to end.
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
        if (url.includes("/api/osdu/kinds")) {
          return new Response(JSON.stringify({ kinds: [targetKind], cursor: null }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        // Create: PUT to the records endpoint returns a server-assigned id.
        if (method === "PUT" && url.endsWith("/api/osdu/records")) {
          window.__newRecordTest.requests.push({ method, url, body: (init && init.body) || null });
          return new Response(JSON.stringify({
            recordCount: 1,
            recordIds: ["tenant:browser-test:master-data--Well(uuid-new)"],
          }), { headers: { "Content-Type": "application/json" } });
        }
        // Schema detail: a data node with inline fields and one $ref-only field.
        const detail = url.match(/\\/api\\/osdu\\/schemas\\/(.+?)(?:\\?|$)/);
        if (method === "GET" && detail) {
          return new Response(JSON.stringify({
            kind: targetKind,
            status: "PUBLISHED",
            schema: {
              properties: {
                data: {
                  properties: {
                    FacilityName: { type: "string" },
                    Depth: { type: "number" },
                    RefField: { $ref: "osdu:wks:AbstractFacility:1.0.0" },
                  },
                },
              },
            },
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
  await browser.call("Page.navigate", { url: `${APP_URL}/schemas` });
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('h1')?.textContent === 'Schema Browser'"),
    "the Schema Browser page",
  );

  // Switch to the Kinds view where the New record action lives.
  await evaluate<void>(browser, browserFunction(() => {
    const tab = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Kinds");
    if (!tab) throw new Error("The Kinds tab was not found");
    (tab as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, `[...document.querySelectorAll('[data-testid="kind-row"]')].some((r) => r.textContent?.includes(${JSON.stringify(TARGET_KIND)}))`),
    "the target kind row",
  );

  // Open the New record dialog for the target kind.
  await evaluate<void>(browser, browserFunction((kind: string) => {
    const btn = document.querySelector(`button[aria-label="Create a new record of ${kind}"]`) as HTMLButtonElement | null;
    if (!btn) throw new Error("The New record button was not found");
    btn.click();
  }, TARGET_KIND));
  await waitFor(
    () => evaluate<boolean>(browser, `document.querySelector('[data-testid="new-record-editor"]') !== null`),
    "the new-record editor to open with a seeded template",
  );

  // The template carries the kind, the boilerplate envelope, and the inline
  // schema fields — but not the $ref-only field.
  const seeded = await evaluate<string>(browser, `document.querySelector('[data-testid="new-record-editor"]')?.value ?? ''`);
  const draft = JSON.parse(seeded) as Record<string, unknown>;
  assert.equal(draft.kind, TARGET_KIND, "the template carries the chosen kind");
  assert.equal("id" in draft, false, "the template carries no id");
  assert.deepEqual(draft.acl, { owners: [], viewers: [] }, "the acl boilerplate is seeded");
  const data = draft.data as Record<string, unknown>;
  assert.equal(data.FacilityName, "", "inline string fields are scaffolded");
  assert.equal(data.Depth, 0, "inline number fields are scaffolded");
  assert.equal("RefField" in data, false, "$ref-only fields are not guessed");

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

  const successText = await evaluate<string>(browser, `document.querySelector('[data-testid="new-record-success"]')?.textContent ?? ''`);
  assert.match(successText, /uuid-new/, "the success banner shows the new record id");

  const requests = await evaluate<{ method: string; url: string; body: string | null }[]>(
    browser,
    "window.__newRecordTest.requests",
  );
  assert.equal(requests.length, 1, "creating fires exactly one PUT to the records endpoint");
  assert.equal(requests[0].method, "PUT", "the create uses PUT");
  assert.match(requests[0].url, /\/api\/osdu\/records$/, "the create targets the storage records endpoint");
  const body = JSON.parse(requests[0].body ?? "null");
  assert.ok(Array.isArray(body), "the request body is an array of records");
  assert.equal(body.length, 1, "the request body holds exactly the new record");
  assert.equal("id" in body[0], false, "a create body carries no id so OSDU assigns one");
  assert.equal(body[0].kind, TARGET_KIND, "the create sends the chosen kind");
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
    await waitForUrl(`${APP_URL}/schemas`, "OSDU Explorer dev server for new-record check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-storage-new-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Storage Service new-record browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
