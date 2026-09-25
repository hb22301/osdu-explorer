import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5184;
const DEBUG_PORT = 9800 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

declare global {
  interface Window {
    __storageDeleteTest: {
      requests: { method: string; url: string }[];
      failMode: "soft" | "purge" | null;
      failDdmsUuid: string | null;
      missingDdmsUuid: string | null;
      copiedText: string | null;
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
      const recordId = "tenant:browser-test:master-data--Well(uuid-store)";
      const encodedId = encodeURIComponent(recordId);
      const storageRecord = {
        id: recordId,
        kind: "osdu:wks:master-data--Well:1.0.0",
        version: 1,
        acl: { owners: ["data.default.owners@browser-test"], viewers: ["data.default.viewers@browser-test"] },
        legal: {},
        data: {
          FacilityName: "Storage deletable record",
          DDMSDatasets: [
            "eml:///dataspace('browser test/dataspace')/resqml20.obj_TriangulatedSetRepresentation(linked-ddms-1)",
            "eml:///dataspace(browser-test-dataspace)/resqml20.obj_Grid2dRepresentation(linked-ddms-2)",
            "eml:///dataspace('browser test/dataspace')/resqml20.obj_TriangulatedSetRepresentation(linked-ddms-1)",
          ],
        },
        meta: [],
        ancestry: {},
        tags: {},
      };
      window.__storageDeleteTest = {
        requests: [],
        failMode: null,
        failDdmsUuid: null,
        missingDdmsUuid: null,
        copiedText: null,
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => { window.__storageDeleteTest.copiedText = text; },
        },
      });

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
        if (url.includes("/api/osdu/search")) {
          return new Response(JSON.stringify({
            results: [{ id: recordId, kind: storageRecord.kind, data: { FacilityName: "Storage deletable record" } }],
            totalCount: 1,
          }), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "DELETE" && url.includes("/api/osdu/rdms/dataspaces/")) {
          window.__storageDeleteTest.requests.push({ method, url });
          if (window.__storageDeleteTest.missingDdmsUuid && url.includes(encodeURIComponent(window.__storageDeleteTest.missingDdmsUuid))) {
            return new Response(JSON.stringify({ error: "DDMS record was already absent" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (window.__storageDeleteTest.failDdmsUuid && url.includes(encodeURIComponent(window.__storageDeleteTest.failDdmsUuid))) {
            return new Response(JSON.stringify({ error: "DDMS record is protected by the browser test" }), {
              status: 409,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
        }
        // Soft delete: POST to .../{id}/delete.
        if (method === "POST" && url.endsWith("/api/osdu/records/" + encodedId + "/delete")) {
          window.__storageDeleteTest.requests.push({ method, url });
          if (window.__storageDeleteTest.failMode === "soft") {
            return new Response(JSON.stringify({ error: "Soft delete rejected: record is protected" }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
        }
        // Purge: DELETE on .../{id}.
        if (method === "DELETE" && url.endsWith("/api/osdu/records/" + encodedId)) {
          window.__storageDeleteTest.requests.push({ method, url });
          if (window.__storageDeleteTest.failMode === "purge") {
            return new Response(JSON.stringify({ error: "Purge rejected: record has active references" }), {
              status: 409,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "GET" && url.includes("/api/osdu/records/")) {
          return new Response(JSON.stringify(storageRecord), { headers: { "Content-Type": "application/json" } });
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

// Drive the search → Storage API viewer flow until the storage Delete button is visible.
async function openStorageViewer(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/search` });
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('h1')?.textContent === 'Record Search'"),
    "Record Search to render",
  );

  await evaluate<void>(browser, browserFunction(() => {
    const input = document.querySelector("form input") as HTMLInputElement | null;
    if (!input) throw new Error("Lucene query input was not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Lucene query input setter was not found");
    setter.call(input, "*:*");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.form?.requestSubmit();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('uuid-store') ?? false"),
    "the mocked search result",
  );

  await evaluate<void>(browser, browserFunction(() => {
    const row = [...document.querySelectorAll("tbody tr")].find((candidate) =>
      candidate.textContent?.includes("uuid-store"));
    if (!row) throw new Error("The search result row was not found");
    (row as HTMLElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('tbody tr[data-state=\"selected\"]') !== null"),
    "the result row to become selected",
  );

  await evaluate<void>(browser, browserFunction(() => {
    const storage = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === "Storage API");
    if (!storage) throw new Error("The Storage API lookup button was not found");
    (storage as HTMLElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Record from Storage Service') ?? false"),
    "the storage record dialog",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Delete record in Storage Service\"]') !== null"),
    "the storage Delete button to appear",
  );
}

// Open the confirmation dialog and assert no request fires before the user confirms.
async function openDeleteConfirm(browser: CdpClient): Promise<void> {
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Delete record in Storage Service"]');
    if (!button) throw new Error("Delete button was not found");
    (button as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"alertdialog\"]')?.textContent?.includes('Delete this Storage Service record?') ?? false"),
    "the delete confirmation dialog to appear",
  );
  assert.equal(
    await evaluate<number>(browser, "window.__storageDeleteTest.requests.length"),
    0,
    "opening the confirmation should not send a delete request",
  );
}

async function clickConfirmAction(browser: CdpClient, label: string): Promise<void> {
  await evaluate<void>(browser, browserFunction((buttonLabel: string) => {
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((candidate) => candidate.textContent?.trim() === buttonLabel);
    if (!confirm) throw new Error("Confirm button was not found: " + buttonLabel);
    (confirm as HTMLButtonElement).click();
  }, label));
}

async function runScenario(browser: CdpClient): Promise<void> {
  const encodedId = "tenant%3Abrowser-test%3Amaster-data--Well(uuid-store)";
  const firstDdmsId = "browser test/dataspace/resqml20.obj_TriangulatedSetRepresentation(linked-ddms-1)";
  const secondDdmsId = "browser-test-dataspace/resqml20.obj_Grid2dRepresentation(linked-ddms-2)";

  // The linked targets are shown and copyable before deletion. Approval deletes
  // both unique DDMS targets before the Storage record, then shows a summary.
  await openStorageViewer(browser);
  await openDeleteConfirm(browser);
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelectorAll('[data-testid^=\"storage-ddms-target-\"]').length === 2"),
    true,
    "the preview should list both unique DDMS targets",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('[data-testid="button-copy-storage-ddms-ids"]');
    if (!button) throw new Error("The copy DDMS IDs button was not found");
    (button as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "window.__storageDeleteTest.copiedText?.includes('linked-ddms-1') ?? false"),
    "the linked DDMS IDs to be copied",
  );
  {
    const copied = await evaluate<string>(browser, "window.__storageDeleteTest.copiedText ?? ''");
    assert.ok(copied.includes(firstDdmsId), "the copied IDs should include the first target");
    assert.ok(copied.includes(secondDdmsId), "the copied IDs should include the second target");
    assert.equal(copied.split("linked-ddms-1").length - 1, 1, "duplicate pointers should appear once in the copy summary");
  }
  await evaluate<void>(browser, browserFunction(() => {
    const checkbox = document.querySelector('[data-testid="checkbox-delete-linked-ddms"]') as HTMLInputElement | null;
    if (!checkbox) throw new Error("The linked DDMS delete checkbox was not found");
    checkbox.click();
  }));
  await clickConfirmAction(browser, "Delete DDMS + soft delete");
  await waitFor(
    () => evaluate<boolean>(browser, "window.__storageDeleteTest.requests.length === 3"),
    "both DDMS deletes and the Storage soft delete to fire",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('Storage record deletion complete') ?? false"),
    "the successful deletion summary to appear",
  );
  {
    const requests = await evaluate<{ method: string; url: string }[]>(browser, "window.__storageDeleteTest.requests");
    assert.equal(requests[0].method, "DELETE", "the first DDMS target should be deleted first");
    assert.ok(requests[0].url.includes("/resources/resqml20.obj_TriangulatedSetRepresentation/linked-ddms-1"));
    assert.equal(requests[1].method, "DELETE", "the second DDMS target should be deleted second");
    assert.ok(requests[1].url.includes("/resources/resqml20.obj_Grid2dRepresentation/linked-ddms-2"));
    assert.equal(requests[2].method, "POST", "Storage soft delete should happen only after both DDMS deletes");
    assert.ok(requests[2].url.endsWith(`/api/osdu/records/${encodedId}/delete`));
  }
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('[data-testid="button-copy-storage-delete-summary"]');
    if (!button) throw new Error("The copy deletion summary button was not found");
    (button as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "window.__storageDeleteTest.copiedText?.includes('soft-deleted') ?? false"),
    "the completion summary to be copied",
  );
  {
    const copied = await evaluate<string>(browser, "window.__storageDeleteTest.copiedText ?? ''");
    assert.ok(copied.includes("uuid-store"), "the completion summary should include the Storage ID");
    assert.ok(copied.includes("linked-ddms-1") && copied.includes("linked-ddms-2"));
  }
  await clickConfirmAction(browser, "Done");
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Delete record in Storage Service\"]') === null"),
    "the viewer to close after the completion summary is dismissed",
  );

  // A missing linked target is treated as already absent, so a retry can
  // continue through the remaining DDMS records and the Storage delete.
  await openStorageViewer(browser);
  await evaluate<void>(browser, "window.__storageDeleteTest.missingDdmsUuid = 'linked-ddms-1'");
  await openDeleteConfirm(browser);
  await evaluate<void>(browser, browserFunction(() => {
    const checkbox = document.querySelector('[data-testid="checkbox-delete-linked-ddms"]') as HTMLInputElement | null;
    if (!checkbox) throw new Error("The linked DDMS delete checkbox was not found");
    checkbox.click();
  }));
  await clickConfirmAction(browser, "Delete DDMS + soft delete");
  await waitFor(
    () => evaluate<boolean>(browser, "window.__storageDeleteTest.requests.length === 3"),
    "the missing DDMS target, remaining DDMS target, and Storage delete requests to fire",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('Storage record deletion complete') ?? false"),
    "the completion summary after an already-absent target",
  );
  assert.equal(
    await evaluate<boolean>(browser, `document.querySelector('[data-testid="storage-delete-completion-summary"]')?.textContent?.includes('Already absent: ${firstDdmsId}') ?? false`),
    true,
    "a 404 from Reservoir DDMS should appear as already absent in the summary",
  );
  {
    const requests = await evaluate<{ method: string; url: string }[]>(browser, "window.__storageDeleteTest.requests");
    assert.ok(requests[0].url.includes("linked-ddms-1"));
    assert.ok(requests[1].url.includes("linked-ddms-2"));
    assert.equal(requests[2].method, "POST", "Storage should be deleted after a linked record is already absent");
  }
  await clickConfirmAction(browser, "Done");

  // If one DDMS delete fails after another succeeds, Storage is not deleted.
  // The completed DDMS delete is reported and skipped on retry.
  await openStorageViewer(browser);
  await evaluate<void>(browser, "window.__storageDeleteTest.failDdmsUuid = 'linked-ddms-2'");
  await openDeleteConfirm(browser);
  await evaluate<void>(browser, browserFunction(() => {
    const checkbox = document.querySelector('[data-testid="checkbox-delete-linked-ddms"]') as HTMLInputElement | null;
    if (!checkbox) throw new Error("The linked DDMS delete checkbox was not found");
    checkbox.click();
  }));
  await clickConfirmAction(browser, "Delete DDMS + soft delete");
  await waitFor(
    () => evaluate<boolean>(browser, "window.__storageDeleteTest.requests.length === 2"),
    "the successful and failed DDMS deletes to fire",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[data-testid=\"storage-delete-partial-summary\"]') !== null"),
    "the partial deletion summary to appear",
  );
  {
    const requests = await evaluate<{ method: string; url: string }[]>(browser, "window.__storageDeleteTest.requests");
    assert.ok(requests[0].url.includes("linked-ddms-1"));
    assert.ok(requests[1].url.includes("linked-ddms-2"));
    assert.equal(requests.some((request) => request.url.includes("/api/osdu/records/")), false, "Storage must not be deleted after a DDMS failure");
  }
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('[data-testid=\"storage-delete-partial-summary\"]')?.textContent?.includes('linked-ddms-1') ?? false"),
    true,
    "the partial summary should identify the DDMS record already deleted",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('[data-testid="button-copy-storage-delete-partial-summary"]');
    if (!button) throw new Error("The copy partial summary button was not found");
    (button as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "window.__storageDeleteTest.copiedText?.includes('Storage record deletion did not complete successfully') ?? false"),
    "the partial summary to be copied",
  );
  assert.ok(
    (await evaluate<string>(browser, "window.__storageDeleteTest.copiedText ?? ''")).includes("linked-ddms-1"),
    "the copied partial summary should include the DDMS record already deleted",
  );
  await evaluate<void>(browser, "window.__storageDeleteTest.failDdmsUuid = null");
  await clickConfirmAction(browser, "Delete DDMS + soft delete");
  await waitFor(
    () => evaluate<boolean>(browser, "window.__storageDeleteTest.requests.length === 4"),
    "the remaining DDMS delete and Storage retry to fire",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('Storage record deletion complete') ?? false"),
    "the retry completion summary to appear",
  );
  {
    const requests = await evaluate<{ method: string; url: string }[]>(browser, "window.__storageDeleteTest.requests");
    assert.ok(requests[2].url.includes("linked-ddms-2"), "retry should continue with the failed DDMS target");
    assert.equal(requests[3].method, "POST", "Storage should be deleted after the retry succeeds");
  }
  await clickConfirmAction(browser, "Done");

  // If Storage fails after the DDMS targets have already been deleted, expose
  // and copy those irreversible partial results.
  await openStorageViewer(browser);
  await evaluate<void>(browser, "window.__storageDeleteTest.failMode = 'soft'");
  await openDeleteConfirm(browser);
  await evaluate<void>(browser, browserFunction(() => {
    const checkbox = document.querySelector('[data-testid="checkbox-delete-linked-ddms"]') as HTMLInputElement | null;
    if (!checkbox) throw new Error("The linked DDMS delete checkbox was not found");
    checkbox.click();
  }));
  await clickConfirmAction(browser, "Delete DDMS + soft delete");
  await waitFor(
    () => evaluate<boolean>(browser, "window.__storageDeleteTest.requests.length === 3"),
    "both DDMS deletes and the rejected Storage soft delete to fire",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"alertdialog\"]')?.textContent?.includes('Soft delete rejected: record is protected') ?? false"),
    "the soft delete API error to appear",
  );
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('[data-testid=\"storage-delete-partial-summary\"]') !== null"),
    true,
    "the Storage failure should show the completed DDMS deletions",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('[data-testid="button-copy-storage-delete-partial-summary"]');
    if (!button) throw new Error("The copy partial summary button was not found");
    (button as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "window.__storageDeleteTest.copiedText?.includes('Storage record deletion did not complete successfully') ?? false"),
    "the Storage failure partial summary to be copied",
  );
  {
    const requests = await evaluate<{ method: string; url: string }[]>(browser, "window.__storageDeleteTest.requests");
    assert.ok(requests[0].url.includes("linked-ddms-1"));
    assert.ok(requests[1].url.includes("linked-ddms-2"));
    assert.equal(requests[2].method, "POST", "Storage should only be attempted after both DDMS records");
    const copied = await evaluate<string>(browser, "window.__storageDeleteTest.copiedText ?? ''");
    assert.ok(copied.includes("linked-ddms-1") && copied.includes("linked-ddms-2"));
  }
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Delete record in Storage Service\"]') !== null"),
    true,
    "the viewer should remain available after a rejected soft delete",
  );

  // Declining the DDMS option preserves Storage-only soft-delete behavior.
  await openStorageViewer(browser);
  await openDeleteConfirm(browser);
  await clickConfirmAction(browser, "Soft delete");
  await waitFor(
    () => evaluate<boolean>(browser, "window.__storageDeleteTest.requests.length === 1"),
    "the soft delete request to fire after confirmation",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('Storage record deletion complete') ?? false"),
    "the successful soft-delete summary to appear",
  );
  {
    const requests = await evaluate<{ method: string; url: string }[]>(browser, "window.__storageDeleteTest.requests");
    assert.equal(requests.length, 1, "the soft delete should fire exactly one request");
    assert.equal(requests[0].method, "POST", "the soft delete should use the POST method");
    assert.ok(
      requests[0].url.endsWith(`/api/osdu/records/${encodedId}/delete`),
      `the soft delete should target the record's :delete endpoint, got ${requests[0].url}`,
    );
  }
  await clickConfirmAction(browser, "Done");
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Delete record in Storage Service\"]') === null"),
    "the viewer to close after the soft-delete summary is dismissed",
  );

  // A rejected purge keeps the viewer open and surfaces the Storage API error.
  await openStorageViewer(browser);
  await evaluate<void>(browser, "window.__storageDeleteTest.failMode = 'purge'");
  await openDeleteConfirm(browser);
  await clickConfirmAction(browser, "Purge");
  await waitFor(
    () => evaluate<boolean>(browser, "window.__storageDeleteTest.requests.length === 1"),
    "the rejected purge request to fire",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"alertdialog\"]')?.textContent?.includes('Purge rejected: record has active references') ?? false"),
    "the purge API error to appear",
  );
  assert.equal(
    await evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Delete record in Storage Service\"]') !== null"),
    true,
    "the viewer should remain available after a rejected purge",
  );

  // Purge: DELETE on .../{id}. A fresh navigation resets the recorded requests.
  await openStorageViewer(browser);
  await openDeleteConfirm(browser);
  await clickConfirmAction(browser, "Purge");
  await waitFor(
    () => evaluate<boolean>(browser, "window.__storageDeleteTest.requests.length === 1"),
    "the purge request to fire after confirmation",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('Storage record deletion complete') ?? false"),
    "the successful purge summary to appear",
  );
  {
    const requests = await evaluate<{ method: string; url: string }[]>(browser, "window.__storageDeleteTest.requests");
    assert.equal(requests.length, 1, "the purge should fire exactly one request");
    assert.equal(requests[0].method, "DELETE", "the purge should use the DELETE method");
    assert.ok(
      requests[0].url.endsWith(`/api/osdu/records/${encodedId}`),
      `the purge should target the record's endpoint, got ${requests[0].url}`,
    );
  }
  await clickConfirmAction(browser, "Done");
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('button[aria-label=\"Delete record in Storage Service\"]') === null"),
    "the viewer to close after the purge summary is dismissed",
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
    await waitForUrl(`${APP_URL}/search`, "OSDU Explorer dev server for Storage delete check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-storage-delete-${process.pid}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "Chromium");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await runScenario(browser);
    console.log("Storage Service delete browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    await delay(150);
    terminateProcess(appServer);
  }
}

await runBrowserCheck();
