import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5183;
const DEBUG_PORT = 9700 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

declare global {
  interface Window {
    __reservoirDeleteTest: {
      requests: { method: string; url: string }[];
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

function mockApiScript(): string {
  return `
    (() => {
      const dataspace = "browser test/dataspace";
      const datatype = "resqml20.obj_WellboreMarkerFrameRepresentation";
      const uuid = "uuid/delete";
      const record = [{
        "$type": datatype,
        Uuid: uuid,
        Citation: { Title: "Browser deletable record" }
      }];
      const resourceRecord = {
        uri: "eml:///dataspace('" + dataspace + "')/" + datatype + "(" + uuid + ")",
        name: "Deletable browser record",
        customData: { creator: "browser-check", created: "2026-01-01T00:00:00.000Z" },
        lastChanged: "2026-01-02T00:00:00.000Z"
      };
      window.__reservoirDeleteTest = { requests: [], failDelete: false };
      let deleted = false;

      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const method = (init && init.method) || "GET";
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/api/osdu/console")) {
          return new Response(JSON.stringify({ entries: [], total: 0 }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/api/osdu/rdms/dataspaces")) {
          return new Response(JSON.stringify({ dataspaces: [dataspace] }), { headers: { "Content-Type": "application/json" } });
        }
        // Delete the record. The RDDMS REST API self-commits this delete, so a
        // single request removes the record with no surrounding transaction.
        if (method === "DELETE" && url.includes("/resources/" + encodeURIComponent(datatype) + "/" + encodeURIComponent(uuid))) {
          window.__reservoirDeleteTest.requests.push({ method, url });
          if (window.__reservoirDeleteTest.failDelete) {
            return new Response(JSON.stringify({
              error: "Reservoir DDMS: cannot delete resource because it is still referenced by another object",
            }), {
              status: 409,
              headers: { "Content-Type": "application/json" },
            });
          }
          deleted = true;
          return new Response(null, { status: 204 });
        }
        if (method === "GET" && url.endsWith("/resources")) {
          return new Response(JSON.stringify({ resources: [{ name: datatype, count: 1 }] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        // The record listing refetches after the delete, so it must reflect the removal.
        if (method === "GET" && url.endsWith("/resources/" + encodeURIComponent(datatype))) {
          return new Response(JSON.stringify({ resources: deleted ? [] : [resourceRecord] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "GET" && url.includes("/resources/" + encodeURIComponent(datatype) + "/" + encodeURIComponent(uuid))) {
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

async function runScenario(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/reservoir-dms` });
  await waitFor(
    () => evaluate<boolean>(browser, "([...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Fetch Resources'))"),
    "Fetch Resources button to become available",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === "Fetch Resources");
    if (!button) throw new Error("Fetch Resources button was not found");
    (button as HTMLElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('WellboreMarkerFrameRepresentation') ?? false"),
    "the mocked resource to load",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const row = [...document.querySelectorAll("table tbody tr")]
      .find((candidate) => candidate.textContent?.includes("WellboreMarkerFrameRepresentation"));
    if (!row) throw new Error("Resource row was not found");
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('uuid/delete') ?? false"),
    "the mocked record row to load",
  );
  // Double-click the record row to open the record detail viewer.
  await evaluate<void>(browser, browserFunction(() => {
    const row = [...document.querySelectorAll("table tbody tr")]
      .find((candidate) => candidate.textContent?.includes("uuid/delete"));
    if (!row) throw new Error("Record row was not found");
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }));
  // The viewer exposes a Delete button once its rdmsContext (dataspace/datatype/uuid) resolves.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Delete record in Reservoir DDMS\"]') !== null"),
    "the viewer Delete button to appear",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Delete record in Reservoir DDMS"]');
    if (!button) throw new Error("Delete button was not found");
    (button as HTMLButtonElement).click();
  }));
  // A confirmation dialog gates the destructive action.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"alertdialog\"]')?.textContent?.includes('Delete this Reservoir DDMS record?') ?? false"),
    "the delete confirmation dialog to appear",
  );

  // No delete request should have been sent until the user confirms.
  assert.equal(
    await evaluate<number>(browser, "window.__reservoirDeleteTest.requests.length"),
    0,
    "opening the confirmation should not send a delete request",
  );

  // A referential-integrity rejection keeps the dialog and record available,
  // while explaining what must change before deletion can succeed.
  await evaluate<void>(browser, "window.__reservoirDeleteTest.failDelete = true");
  await evaluate<void>(browser, browserFunction(() => {
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((candidate) => candidate.textContent?.trim() === "Delete");
    if (!confirm) throw new Error("Delete confirm button was not found");
    (confirm as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "window.__reservoirDeleteTest.requests.length === 1"),
    "the rejected delete request to fire",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"alert\"]')?.textContent?.includes('Deletion blocked') && document.querySelector('[role=\"alert\"]')?.textContent?.includes('another object still references this record')"),
    "the referential-integrity explanation to appear",
  );
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Delete record in Reservoir DDMS\"]') !== null"),
    true,
    "the viewer should remain available after a rejected delete",
  );
  {
    const requests = await evaluate<{ method: string; url: string }[]>(
      browser,
      "window.__reservoirDeleteTest.requests",
    );
    assert.deepEqual(
      requests.map((request) => request.method),
      ["DELETE"],
      "a rejected delete should fire exactly one DELETE request",
    );
    assert.doesNotMatch(
      requests[0].url,
      /transactionId/,
      "the delete should not create or reference a transaction",
    );
  }

  await evaluate<void>(browser, "window.__reservoirDeleteTest.failDelete = false; window.__reservoirDeleteTest.requests = []");
  await evaluate<void>(browser, browserFunction(() => {
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((candidate) => candidate.textContent?.trim() === "Delete");
    if (!confirm) throw new Error("Delete confirm button was not found");
    (confirm as HTMLButtonElement).click();
  }));

  await waitFor(
    () => evaluate<boolean>(browser, "window.__reservoirDeleteTest.requests.length === 1"),
    "the delete request to fire after confirmation",
  );
  // The detail viewer closes on a successful delete, returning to the record list.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Delete record in Reservoir DDMS\"]') === null"),
    "the record detail viewer to close after a successful delete",
  );

  const requests = await evaluate<{ method: string; url: string }[]>(
    browser,
    "window.__reservoirDeleteTest.requests",
  );
  assert.deepEqual(
    requests.map((request) => request.method),
    ["DELETE"],
    "a successful delete should fire exactly one self-committing DELETE request",
  );
  assert.match(
    requests[0].url,
    /\/resources\/resqml20\.obj_WellboreMarkerFrameRepresentation\/uuid%2Fdelete$/,
    "the delete should target the record's resource URI with no transaction",
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
    await waitForUrl(`${APP_URL}/reservoir-dms`, "OSDU Explorer dev server for Reservoir delete check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-reservoir-delete-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Reservoir DDMS delete browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
