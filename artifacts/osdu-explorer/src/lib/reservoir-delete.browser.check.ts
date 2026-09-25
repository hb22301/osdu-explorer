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
      requests: { method: string; url: string; body?: string | null }[];
      failDelete: boolean;
      throwDelete: boolean;
      failCascade: boolean;
      referencers: { uri: string; datatype: string; uuid: string; name: string }[];
    };
  }
}

// The referencing records the cascade scenario discovers for the target. Two
// records → a "Delete 3 records" cascade (well below the acknowledgement threshold).
const CASCADE_REFERENCERS = [
  {
    uri: "eml:///dataspace('browser test/dataspace')/resqml20.obj_TriangulatedSetRepresentation(ref-uuid-1)",
    datatype: "resqml20.obj_TriangulatedSetRepresentation",
    uuid: "ref-uuid-1",
    name: "First referencing record",
  },
  {
    uri: "eml:///dataspace('browser test/dataspace')/resqml20.obj_Grid2dRepresentation(ref-uuid-2)",
    datatype: "resqml20.obj_Grid2dRepresentation",
    uuid: "ref-uuid-2",
    name: "Second referencing record",
  },
];

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
      window.__reservoirDeleteTest = { requests: [], failDelete: false, throwDelete: false, failCascade: false, referencers: [] };
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
        // Discovery: the records that reference the target. The delete dialog
        // calls this on open to preview the cascade blast radius. Checked before
        // the record GET below, whose URL is a prefix of this one.
        if (method === "GET" && url.includes("/sources")) {
          return new Response(JSON.stringify({
            referencers: window.__reservoirDeleteTest.referencers,
            truncated: false,
          }), { headers: { "Content-Type": "application/json" } });
        }
        // Atomic cascade delete of the referencer set + target. The server
        // orchestrates the transaction (start, delete-each, commit, rollback),
        // so the frontend only ever issues this single POST.
        if (method === "POST" && url.includes("/cascade-delete")) {
          window.__reservoirDeleteTest.requests.push({ method, url, body: init && init.body ? String(init.body) : null });
          if (window.__reservoirDeleteTest.failCascade) {
            // Commit was refused because references shifted; the server rolled back.
            return new Response(JSON.stringify({
              error: "Reservoir DDMS: 2 dangling reference(s) in space " + dataspace,
            }), { status: 412, headers: { "Content-Type": "application/json" } });
          }
          deleted = true;
          return new Response(JSON.stringify({
            ok: true,
            deletedCount: window.__reservoirDeleteTest.referencers.length + 1,
          }), { headers: { "Content-Type": "application/json" } });
        }
        // Delete the record. The RDDMS REST API self-commits this delete, so a
        // single request removes the record with no surrounding transaction.
        if (method === "DELETE" && url.includes("/resources/" + encodeURIComponent(datatype) + "/" + encodeURIComponent(uuid))) {
          window.__reservoirDeleteTest.requests.push({ method, url });
          // A thrown fetch models a transport failure (offline, DNS, aborted).
          if (window.__reservoirDeleteTest.throwDelete) {
            throw new TypeError("Failed to fetch");
          }
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

async function clickDialogButton(browser: CdpClient, label: string): Promise<void> {
  await evaluate<void>(browser, browserFunction((text: string) => {
    const button = [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((candidate) => candidate.textContent?.trim() === text);
    if (!button) throw new Error("Dialog button not found: " + text);
    (button as HTMLButtonElement).click();
  }, label));
}

async function openDeleteDialog(browser: CdpClient): Promise<void> {
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Delete record in Reservoir DDMS"]');
    if (!button) throw new Error("Delete trash button was not found");
    (button as HTMLButtonElement).click();
  }));
}

async function runScenario(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/reservoir-dms` });
  await waitFor(
    () => evaluate<boolean>(browser, "([...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Fetch Resources' && !button.disabled))"),
    "Fetch Resources button to become enabled",
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

  // A transport failure (thrown fetch) must not strand the dialog: the delete
  // has to resolve to an error, re-enable the buttons, and keep the viewer open
  // so the user can retry rather than being stuck behind a spinner forever.
  await evaluate<void>(browser, "window.__reservoirDeleteTest.throwDelete = true");
  await evaluate<void>(browser, browserFunction(() => {
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((candidate) => candidate.textContent?.trim() === "Delete");
    if (!confirm) throw new Error("Delete confirm button was not found");
    (confirm as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"alert\"]')?.textContent?.includes('Deletion blocked') ?? false"),
    "the transport-failure error to appear",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "(() => { const b = [...document.querySelectorAll('[role=\"alertdialog\"] button')].find((c) => c.textContent?.trim() === 'Delete'); return b instanceof HTMLButtonElement && !b.disabled; })()"),
    "the Delete button to re-enable after a transport failure",
  );
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('[role=\"alertdialog\"]') !== null"),
    true,
    "the confirmation dialog should stay open after a transport failure",
  );
  await evaluate<void>(browser, "window.__reservoirDeleteTest.throwDelete = false; window.__reservoirDeleteTest.requests = []");

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

  // --- Cascade delete: a referenced record deletes together with its referencers ---
  // Dismiss the single-delete dialog, then reopen it against a target that now
  // reports referencing records, so the dialog must offer an atomic cascade.
  await evaluate<void>(browser, "window.__reservoirDeleteTest.failDelete = false");
  await clickDialogButton(browser, "Cancel");
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"alertdialog\"]') === null"),
    "the delete dialog to close on cancel",
  );
  await evaluate<void>(
    browser,
    `window.__reservoirDeleteTest.referencers = ${JSON.stringify(CASCADE_REFERENCERS)}; window.__reservoirDeleteTest.requests = []`,
  );
  await openDeleteDialog(browser);
  // Discovery runs on open; the dialog must preview the blast radius.
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[data-testid=\"rdms-cascade-preview\"]') !== null"),
    "the cascade blast-radius preview to appear",
  );
  {
    const previewText = await evaluate<string>(
      browser,
      "document.querySelector('[data-testid=\"rdms-cascade-preview\"]')?.textContent ?? ''",
    );
    assert.match(previewText, /2 other records/, "the preview should count the referencing records");
    assert.match(previewText, /ref-uuid-1/, "the preview should list the first referencer");
    assert.match(previewText, /ref-uuid-2/, "the preview should list the second referencer");
  }
  // With 2 referencers (below the acknowledgement threshold) the destructive
  // button deletes all 3 records together and is immediately enabled.
  await waitFor(
    () => evaluate<boolean>(browser, "[...document.querySelectorAll('[role=\"alertdialog\"] button')].some((b) => b.textContent?.trim() === 'Delete 3 records' && !b.disabled)"),
    "the 'Delete 3 records' button to be enabled",
  );

  // A cascade whose commit is refused (references shifted) is rolled back server
  // side; the frontend must explain nothing was deleted and keep the dialog open.
  await evaluate<void>(browser, "window.__reservoirDeleteTest.failCascade = true; window.__reservoirDeleteTest.requests = []");
  await clickDialogButton(browser, "Delete 3 records");
  await waitFor(
    () => evaluate<boolean>(browser, "window.__reservoirDeleteTest.requests.length === 1"),
    "the cascade delete request to fire",
  );
  {
    const requests = await evaluate<{ method: string; url: string; body?: string | null }[]>(
      browser,
      "window.__reservoirDeleteTest.requests",
    );
    assert.equal(requests.length, 1, "a cascade should issue exactly one request from the frontend");
    assert.equal(requests[0].method, "POST", "the cascade should POST to the orchestration endpoint");
    assert.match(requests[0].url, /\/cascade-delete$/, "the cascade should target the cascade-delete endpoint");
    const body = JSON.parse(requests[0].body ?? "{}") as { target?: { uuid?: string }; referencers?: unknown[] };
    assert.equal(body.target?.uuid, "uuid/delete", "the cascade body should carry the target record");
    assert.equal(body.referencers?.length, 2, "the cascade body should carry the confirmed referencer set");
  }
  await waitFor(
    () => evaluate<boolean>(browser, "(document.querySelector('[role=\"alert\"]')?.textContent?.includes('Deletion blocked') && document.querySelector('[role=\"alert\"]')?.textContent?.includes('re-check')) ?? false"),
    "the cascade rollback / re-check guidance to appear",
  );
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('[role=\"alertdialog\"]') !== null"),
    true,
    "the dialog should stay open after a rolled-back cascade",
  );

  // Retrying once the references settle deletes all three records atomically and
  // closes the viewer — the same success path a single delete uses.
  await evaluate<void>(browser, "window.__reservoirDeleteTest.failCascade = false; window.__reservoirDeleteTest.requests = []");
  await clickDialogButton(browser, "Delete 3 records");
  await waitFor(
    () => evaluate<boolean>(browser, "window.__reservoirDeleteTest.requests.length === 1"),
    "the retried cascade delete request to fire",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Delete record in Reservoir DDMS\"]') === null"),
    "the record detail viewer to close after a successful cascade delete",
  );

  const requests = await evaluate<{ method: string; url: string }[]>(
    browser,
    "window.__reservoirDeleteTest.requests",
  );
  assert.deepEqual(
    requests.map((request) => request.method),
    ["POST"],
    "a successful cascade should fire exactly one POST to the orchestration endpoint",
  );
  assert.match(
    requests[0].url,
    /\/cascade-delete$/,
    "the cascade should target the cascade-delete orchestration endpoint",
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
