import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 5180;
const DEBUG_PORT = 9400 + (process.pid % 100);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";

declare global {
  interface Window {
    __grid2dSurfaceTest: {
      arrayRequests: string[];
      forceArrayError: boolean;
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

function mockApiScript(forceNoWebgl: boolean): string {
  return `
    (() => {
      const dataspace = "browser test/dataspace";
      const datatype = "resqml20.obj_Grid2dRepresentation";
      const uuid = "uuid/grid2d";
      const record = [{
        "$type": datatype,
        Uuid: uuid,
        Citation: { Title: "Browser Grid2d surface" },
        Grid2dPatch: {
          FastestAxisCount: 3,
          SlowestAxisCount: 2,
          Geometry: {
            Points: {
              SupportingGeometry: {
                Origin: { Coordinate1: 100, Coordinate2: 200, Coordinate3: 0 },
                Offset: [
                  { Offset: { Coordinate1: 1, Coordinate2: 0, Coordinate3: 0 }, Spacing: { Value: 10 } },
                  { Offset: { Coordinate1: 0, Coordinate2: 1, Coordinate3: 0 }, Spacing: { Value: 20 } }
                ]
              },
              ZValues: { Values: { PathInHdfFile: "/grid/z values" } }
            }
          }
        }
      }];
      const resourceName = datatype;
      const resourceRecord = {
        uri: "eml:///dataspace('" + dataspace + "')/" + datatype + "(" + uuid + ")",
        name: "Grid2d browser surface",
        customData: { creator: "browser-check", created: "2026-01-01T00:00:00.000Z" },
        lastChanged: "2026-01-02T00:00:00.000Z"
      };
      window.__grid2dSurfaceTest = { arrayRequests: [], forceArrayError: false };

      if (${JSON.stringify(forceNoWebgl)}) {
        Object.defineProperty(window, "WebGLRenderingContext", { configurable: true, value: undefined });
        const realGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
          if (kind === "webgl" || kind === "experimental-webgl" || kind === "webgl2") return null;
          return realGetContext.call(this, kind, ...args);
        };
      }

      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/api/osdu/console")) {
          return new Response(JSON.stringify({ entries: [], total: 0 }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/api/osdu/rdms/dataspaces")) {
          return new Response(JSON.stringify({ dataspaces: [dataspace] }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/resources")) {
          return new Response(JSON.stringify({ resources: [{ name: resourceName, count: 1 }] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/resources/" + encodeURIComponent(resourceName))) {
          return new Response(JSON.stringify({ resources: [resourceRecord] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/resources/" + encodeURIComponent(resourceName) + "/" + encodeURIComponent(uuid) + "/arrays?")) {
          window.__grid2dSurfaceTest.arrayRequests.push(url);
          await new Promise((resolve) => setTimeout(resolve, 180));
          if (window.__grid2dSurfaceTest.forceArrayError) {
            return new Response(JSON.stringify({ error: "Mocked Grid2d array request failed" }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({
            data: { dimensions: [2, 3], data: [10, 11, 12, 13, 14, 15] }
          }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/resources/" + encodeURIComponent(resourceName) + "/" + encodeURIComponent(uuid))) {
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

async function openRecord(browser: CdpClient): Promise<void> {
  await browser.call("Page.navigate", { url: `${APP_URL}/reservoir-dms` });
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('Reservoir DDMS Data') ?? false"),
    "Reservoir DDMS page to render",
  );
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
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('Grid2dRepresentation') ?? false"),
    "the mocked Grid2d resource to load",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const row = [...document.querySelectorAll("table tbody tr")]
      .find((candidate) => candidate.textContent?.includes("Grid2dRepresentation"));
    if (!row) throw new Error("Grid2d resource row was not found");
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body?.innerText.includes('uuid/grid2d') ?? false"),
    "the mocked Grid2d record to load",
  );
  await evaluate<void>(browser, browserFunction(() => {
    const row = [...document.querySelectorAll("table tbody tr")]
      .find((candidate) => candidate.textContent?.includes("uuid/grid2d"));
    if (!row) throw new Error("Grid2d record row was not found");
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.querySelector('[role=\"dialog\"]')?.innerText.includes('Grid2dRepresentation') ?? false"),
    "the Grid2d record detail dialog to open",
  );
}

async function runScenario(browser: CdpClient, forceNoWebgl: boolean): Promise<void> {
  await openRecord(browser);
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Visualize Grid2d surface"]');
    if (!button) throw new Error("Visualize Grid2d surface button was not found");
    (button as HTMLButtonElement).click();
  }));
  assert.equal(
    await evaluate<boolean>(browser, "document.body.innerText.includes('Grid2d Surface — 3D') && document.body.innerText.includes('Loading grid surface')"),
    true,
    "visualization should open and show its loading state",
  );
  await waitFor(
    () => evaluate<boolean>(browser, "document.body.innerText.includes('Colormap') || document.body.innerText.includes('3D rendering is unavailable — this browser/session has no WebGL context.')"),
    "the Grid2d surface result or WebGL fallback",
  );

  const request = await evaluate<string>(browser, "window.__grid2dSurfaceTest.arrayRequests[0] ?? ''");
  assert.match(request, /dataspaces\/browser%20test%2Fdataspace\/resources\//, "dataspace path should be encoded");
  assert.match(request, /resqml20\.obj_Grid2dRepresentation\/uuid%2Fgrid2d\/arrays\?/, "datatype and UUID path should be encoded");
  assert.equal(
    await evaluate<string>(browser, "new URL(window.__grid2dSurfaceTest.arrayRequests[0], location.origin).searchParams.get('path')"),
    "/grid/z values",
    "array path should be sent as the encoded query parameter",
  );

  const renderedUi = await evaluate<{ controls: boolean; legend: boolean; fallback: boolean }>(browser, `(() => {
    const text = document.body.innerText;
    return {
      controls: text.includes("Colormap") && text.includes("Wireframe") && text.includes("Grid") && text.includes("Animate") && text.includes("Reset view"),
      legend: text.includes("Browser Grid2d surface") && document.querySelector('[style*="linear-gradient"]') !== null,
      fallback: text.includes("3D rendering is unavailable — this browser/session has no WebGL context.")
    };
  })()`);
  if (forceNoWebgl) {
    assert.equal(renderedUi.fallback, true, "the no-WebGL fallback should be visible");
  } else {
    assert.equal(renderedUi.controls, true, "the loaded surface should render its controls");
    assert.equal(renderedUi.legend, true, "the loaded surface should render its legend");

    // The grid overlay toggle flips between "Grid" and "Hide grid".
    await evaluate<void>(browser, browserFunction(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "Grid");
      if (!button) throw new Error("Grid toggle button was not found");
      (button as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser, "[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Hide grid')"),
      "the Grid toggle to finish rendering",
    );
    const toggledLabel = await evaluate<string>(browser, "([...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Hide grid')?.textContent?.trim() ?? '')");
    assert.equal(toggledLabel, "Hide grid", "the grid toggle should switch to Hide grid when enabled");
    await evaluate<void>(browser, browserFunction(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "Hide grid");
      if (!button) throw new Error("Hide grid button was not found");
      (button as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser, "[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Grid')"),
      "the Grid toggle to reset",
    );

    // The turntable animation toggle flips between "Animate" and "Stop".
    await evaluate<void>(browser, browserFunction(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "Animate");
      if (!button) throw new Error("Animate toggle button was not found");
      (button as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser, "[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Stop')"),
      "the animation toggle to switch to Stop",
    );
    const animateLabel = await evaluate<string>(browser, "([...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Stop')?.textContent?.trim() ?? '')");
    assert.equal(animateLabel, "Stop", "the animation toggle should switch to Stop when enabled");
    await evaluate<void>(browser, browserFunction(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "Stop");
      if (!button) throw new Error("Stop button was not found");
      (button as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser, "[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Animate')"),
      "the animation toggle to reset",
    );
  }

  await evaluate<void>(browser, browserFunction(() => {
    const close = [...document.querySelectorAll('button[aria-label="Close"]')].at(-1);
    if (!close) throw new Error("Grid2d overlay close button was not found");
    (close as HTMLElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body.innerText.includes('Grid2d Surface — 3D') === false"),
    "the Grid2d overlay to close",
  );
  await evaluate<void>(browser, "window.__grid2dSurfaceTest.forceArrayError = true");
  await evaluate<void>(browser, browserFunction(() => {
    const button = document.querySelector('button[aria-label="Visualize Grid2d surface"]');
    if (!button) throw new Error("Visualize Grid2d surface button was not found for error scenario");
    (button as HTMLButtonElement).click();
  }));
  await waitFor(
    () => evaluate<boolean>(browser, "document.body.innerText.includes('Mocked Grid2d array request failed')"),
    "the visible Grid2d array error state",
  );
  assert.equal(
    await evaluate<number>(browser, "window.__grid2dSurfaceTest.arrayRequests.length"),
    2,
    "the success and error scenarios should each request the Reservoir array",
  );
}

async function runBrowserCheck(): Promise<void> {
  let appServer: ChildProcess | undefined;
  try {
    appServer = spawn("pnpm", ["--filter", "@workspace/osdu-explorer", "run", "dev"], {
      cwd: process.cwd(),
      env: { ...process.env, BASE_PATH: "/", PORT: String(APP_PORT) },
      detached: true,
      stdio: "ignore",
    });
    await waitForUrl(`${APP_URL}/reservoir-dms`, "OSDU Explorer dev server for Grid2d check");

    for (const [forceNoWebgl, label] of [[false, "WebGL"], [true, "no-WebGL"]] as const) {
      let chromium: ChildProcess | undefined;
      let browser: CdpClient | undefined;
      try {
        chromium = spawn(CHROMIUM_PATH, [
          "--headless=new",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          ...(forceNoWebgl
            ? ["--disable-gpu"]
            : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
          "--remote-allow-origins=*",
          `--remote-debugging-port=${DEBUG_PORT}`,
          `--user-data-dir=/tmp/osdu-grid2d-surface-${process.pid}-${forceNoWebgl ? "fallback" : "render"}`,
          "about:blank",
        ], { detached: true, stdio: "ignore" });
        await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, `${label} Chromium`);
        const target = await getPageTarget();
        browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
        await browser.call("Runtime.enable");
        await browser.call("Page.enable");
        await browser.call("Page.addScriptToEvaluateOnNewDocument", {
          source: mockApiScript(forceNoWebgl),
        });
        await runScenario(browser, forceNoWebgl);
        console.log(`Grid2d ${label} browser check passed.`);
      } finally {
        browser?.close();
        terminateProcess(chromium);
        await delay(150);
      }
    }
  } finally {
    terminateProcess(appServer);
  }
}

await runBrowserCheck();