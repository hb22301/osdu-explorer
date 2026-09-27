import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5191;
const DEBUG_PORT = 9800 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

const RECORD_ID = "tenant:acl-test:master-data--Well(acl-record)";
const OWNER = "data.default.owners@opendes.dataservices.energy";
const VIEWER = "data.default.viewers@opendes.dataservices.energy";

declare global {
  interface Window {
    __aclTest: { puts: unknown[] };
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

// Mock config, the record fetch, its version list, the caller's entitlement
// groups (which include the owner group so no lock-out warning fires), and
// capture PUTs to the Storage records endpoint.
function mockApiScript(): string {
  return `
    (() => {
      const recordId = ${JSON.stringify(RECORD_ID)};
      const owner = ${JSON.stringify(OWNER)};
      const viewer = ${JSON.stringify(VIEWER)};
      window.__aclTest = { puts: [] };
      const record = {
        id: recordId,
        kind: "osdu:wks:master-data--Well:1.0.0",
        version: 100,
        acl: { owners: [owner], viewers: [] },
        legal: { legaltags: ["opendes-public"], otherRelevantDataCountries: ["US"] },
        meta: [],
        ancestry: {},
        tags: {},
        data: { FacilityName: "ACL demo record" },
      };
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const method = (init && init.method) || "GET";
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/api/osdu/entitlements/groups")) {
          return new Response(JSON.stringify({ groups: [
            { name: "data.default.owners", email: owner, description: "owners" },
            { name: "data.default.viewers", email: viewer, description: "viewers" },
            { name: "data.other.owners", email: "data.other.owners@opendes.dataservices.energy", description: "other" },
          ] }), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "PUT" && url.includes("/api/osdu/records")) {
          window.__aclTest.puts.push(JSON.parse(init.body));
          return new Response(JSON.stringify({ recordCount: 1, recordIds: [recordId] }), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "GET" && url.includes("/versions")) {
          return new Response(JSON.stringify({ recordId, versions: [100] }), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "GET" && url.includes("/api/osdu/records/")) {
          return new Response(JSON.stringify(record), { headers: { "Content-Type": "application/json" } });
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

// Set a controlled input's value the React way, then fire an input event.
function setInputExpr(ariaLabel: string, value: string): string {
  return browserFunction((label: string, val: string) => {
    const input = document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;
    if (!input) throw new Error(`Input ${label} was not found`);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("value setter not found");
    setter.call(input, val);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, ariaLabel, value);
}

function clickByAriaExpr(selector: string): string {
  return browserFunction((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`Element ${sel} was not found`);
    el.click();
  }, selector);
}

async function openAclTab(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/records/${encodeURIComponent(RECORD_ID)}` });
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('ACL & Legal') ?? false"),
    "the record page to render",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes("ACL & Legal"));
    if (!tab) throw new Error("ACL tab was not found");
    (tab as HTMLElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[data-testid=\"acl-owners-list\"]') !== null"),
    "the ACL editor",
  );
}

async function runScenario(browser: CdpClient): Promise<void> {
  await openAclTab(browser);

  // The seeded owner chip renders.
  await waitFor(
    () => evaluate<boolean>(browser, `[...document.querySelectorAll('[data-testid="acl-owners-chip"]')].some((c) => c.textContent?.includes(${JSON.stringify(OWNER)}))`),
    "the seeded owner chip",
  );

  // Guard: removing the only owner surfaces the lockout error and disables Save.
  await evaluate<void>(browser, browserFunction((owner: string) => {
    const btn = document.querySelector(`button[aria-label="Remove owners group ${owner}"]`) as HTMLElement | null;
    if (!btn) throw new Error("owner remove button not found");
    btn.click();
  }, OWNER));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[data-testid=\"acl-error\"]')?.textContent?.includes('at least one owner') ?? false"),
    "the empty-owners error",
  );
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Save ACL\"]')?.disabled ?? false"),
    true,
    "Save must be disabled with no owners",
  );

  // Re-add the owner group.
  await evaluate<void>(browser, setInputExpr("Add owners group", OWNER));
  await evaluate<void>(browser, clickByAriaExpr('button[aria-label="Add owners group button"]'));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[data-testid=\"acl-error\"]') === null"),
    "the error to clear after re-adding an owner",
  );

  // Add a viewer group.
  await evaluate<void>(browser, setInputExpr("Add viewers group", VIEWER));
  await evaluate<void>(browser, clickByAriaExpr('button[aria-label="Add viewers group button"]'));
  await waitFor(
    () => evaluate<boolean>(browser, `[...document.querySelectorAll('[data-testid="acl-viewers-chip"]')].some((c) => c.textContent?.includes(${JSON.stringify(VIEWER)}))`),
    "the added viewer chip",
  );

  // Save and assert the PUT carried the edited ACL.
  await evaluate<void>(browser, clickByAriaExpr('button[aria-label="Save ACL"]'));
  await waitFor(
    () => evaluate<boolean>(browser, "window.__aclTest.puts.length > 0"),
    "the Storage PUT to fire",
  );
  const put = await evaluate<any[]>(browser, "window.__aclTest.puts[0]");
  assert.ok(Array.isArray(put), "PUT body should be an array of records");
  const saved = put[0];
  assert.deepEqual(saved.acl.owners, [OWNER], "owners should persist");
  assert.deepEqual(saved.acl.viewers, [VIEWER], "the added viewer should persist");

  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[data-testid=\"acl-saved\"]') !== null"),
    "the ACL saved confirmation",
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
    await waitForUrl(`${APP_URL}/search`, "OSDU Explorer dev server for ACL edit check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-acl-edit-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Record ACL edit browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
