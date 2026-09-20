: true, button: 0 }));
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

function reservoirTableMockApiScript(): string {
  return `
    (() => {
      const dataspace = "browser-test-dataspace";
      const datatype = "resqml20.obj_Grid2dRepresentation";
      const records = Array.from({ length: 75 }, (_, index) => {
        const number = index + 1;
        const padded = String(number).padStart(3, "0");
        const day = String((number % 28) + 1).padStart(2, "0");
        return {
          uri: "tenant:browser-test:" + datatype + "(uuid-" + padded + ")",
          name: "Record " + padded,
          customData: {
            creator: "creator-" + (number % 3),
            created: "2026-01-" + day + "T00:00:00.000Z",
          },
          lastChanged: "2026-02-" + day + "T00:00:00.000Z",
        };
      });
      const detail = (uuid) => {
        const record = records.find((candidate) => candidate.uri.endsWith("(" + uuid + ")"));
        return {
          uri: record?.uri ?? "tenant:browser-test:" + datatype + "(" + uuid + ")",
          name: record?.name ?? uuid,
          customData: record?.customData ?? { creator: "unknown" },
          lastChanged: record?.lastChanged ?? "2026-02-01T00:00:00.000Z",
          browserCheck: true,
        };
      };
      window.__reservoirTableTest = { detailRequests: [] };
      const realFetch = window.fetch.bind(window);

      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/osdu/console")) {
          return new Response(JSON.stringify({ entries: [], total: 0 }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/api/osdu/rdms/dataspaces")) {
          return new Response(JSON.stringify({ dataspaces: [dataspace] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/resources")) {
          return new Response(JSON.stringify({
            resources: [{ name: datatype, count: records.length }],
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/resources/" + datatype + "/")) {
          const uuid = decodeURIComponent(url.split("/").at(-1) ?? "");
          window.__reservoirTableTest.detailRequests.push(uuid);
          return new Response(JSON.stringify(detail(uuid)), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/resources/" + datatype)) {
          return new Response(JSON.stringify({ resources: records }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return realFetch(input, init);
      };
    })();
  `;
}

function recordLookupMockApiScript(): string {
  return `
    (() => {
      const recordId = "tenant:browser-test:resqml20.obj_Grid2dRepresentation(uuid-root)";
      const storageRecord = {
        id: recordId,
        kind: "resqml20.obj_Grid2dRepresentation",
        version: 1,
        acl: {},
        legal: {},
        data: {
          "$type": "resqml20.obj_Grid2dRepresentation",
          uuid: "uuid-root",
          DDMSDatasets: [
            "eml:///dataspace(browser-test-dataspace)/resqml20.obj_Grid2dRepresentation(uuid-root)"
          ],
          Grid2dPatch: {
            Geometry: {
              Points: {
                ZValues: {
                  Values: {
                    PathInHdfFile: "browser-test/grid/z-values"
                  }
                }
              }
            }
          },
          name: "Shared lookup browser test record",
        },
        meta: [],
        ancestry: {},
        tags: {},
      };
      const reservoirRecord = [{
        "$type": "resqml20.obj_Grid2dRepresentation",
        Uuid: "uuid-root",
        name: "Reservoir DDMS browser test record",
        browserCheck: true,
        Grid2dPatch: {
          Geometry: {
            Points: {
              ZValues: {
                Values: {
                  PathInHdfFile: "/resqml20/uuid-root/points_patch0"
                }
              }
            }
          }
        }
      }];
      const realFetch = window.fetch.bind(window);
      window.__recordLookupTest = {
        recordRequests: [],
        reservoirRequests: [],
        arrayRequests: [],
        copiedText: "",
        forceArrayError: false,
      };
      const captureCopiedText = async (text) => {
        window.__recordLookupTest.copiedText = text;
      };
      try {
        if (navigator.clipboard) {
          navigator.clipboard.writeText = captureCopiedText;
        } else {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: captureCopiedText },
          });
        }
      } catch {
        // Clipboard interception is only for asserting the copy interaction.
        // Never let it prevent the API mocks from being installed.
      }

      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/osdu/kinds")) {
          return new Response(JSON.stringify({ kinds: [] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/osdu/search")) {
          return new Response(JSON.stringify({
            results: [{
              id: recordId,
              kind: "resqml20.obj_Grid2dRepresentation",
              data: { Name: "Shared lookup browser test record" },
            }],
            totalCount: 1,
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/osdu/records/")) {
          window.__recordLookupTest.recordRequests.push(url);
          return new Response(JSON.stringify(storageRecord), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/osdu/rdms/dataspaces/browser-test-dataspace/resources/") && url.includes("/arrays?")) {
          window.__recordLookupTest.arrayRequests.push(url);
          if (window.__recordLookupTest.forceArrayError) {
            return new Response(JSON.stringify({ error: "Mocked Reservoir array data failed" }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({
            data: {
              dimensions: [2, 24],
              data: Array.from({ length: 48 }, (_, index) => index + 1),
            },
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/osdu/rdms/dataspaces/browser-test-dataspace/resources/")) {
          window.__recordLookupTest.reservoirRequests.push(url);
          return new Response(JSON.stringify(reservoirRecord), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return realFetch(input, init);
      };
    })();
  `;
}

function largeRddmsMockApiScript(): string {
  return `
    (() => {
      const recordId = "tenant:browser-test:resqml20.obj_Grid2dRepresentation(uuid-large)";
      const makeLargePayload = () => ({
        "$type": "resqml20.obj_Grid2dRepresentation",
        uuid: "uuid-large",
        Uuid: "uuid-large",
        name: "Large RDDMS response browser regression fixture",
        DDMSDatasets: [
          "eml:///dataspace(browser-test-dataspace)/resqml20.obj_Grid2dRepresentation(uuid-large)"
        ],
        Grid2dPatch: {
          Geometry: {
            Points: {
              ZValues: {
                Values: {
                  PathInHdfFile: "/resqml20/uuid-large/points_patch0"
                }
              }
            }
          }
        },
        gridMetadata: {
          dimensions: { iCount: 240, jCount: 180, kCount: 1 },
          coordinateReferenceSystem: {
            name: "OSDU browser regression CRS",
            authority: "EPSG",
            code: 4326,
            details: {
              axis: ["longitude", "latitude", "elevation"],
              units: ["degrees", "degrees", "metres"],
              provenance: {
                source: "synthetic RDDMS response",
                description: "Nested metadata keeps the fixture representative of a real record."
              }
            }
          }
        },
        patches: Array.from({ length: 1200 }, (_, index) => ({
          patchIndex: index,
          title: "Patch " + String(index + 1).padStart(4, "0"),
          metadata: {
            source: "browser-regression",
            status: index % 5 === 0 ? "boundary" : "interior",
            tags: ["grid", "geometry", "resqml", "patch-" + (index % 24)],
            bounds: {
              min: { x: index * 0.25, y: index * 0.5, z: -index * 0.1 },
              max: { x: index * 0.25 + 10, y: index * 0.5 + 10, z: -index * 0.1 + 2 }
            }
          },
          samples: Array.from({ length: 8 }, (_, sample) => ({
            sampleIndex: sample,
            values: [
              index * 0.001 + sample,
              index * 0.002 + sample * 0.5,
              index * 0.003 - sample * 0.25
            ],
            quality: sample % 3 === 0 ? "measured" : "interpolated"
          }))
        })),
        responseMarker: "large-rddms-response-browser-regression"
      });
      const largeReservoirRecord = [makeLargePayload()];
      const storageRecord = {
        id: recordId,
        kind: "resqml20.obj_Grid2dRepresentation",
        version: 1,
        acl: {},
        legal: {},
        data: makeLargePayload(),
        meta: [],
        ancestry: {},
        tags: {},
      };

      window.__largeRddmsTest = {
        copiedText: "",
        csvText: "",
        recordRequests: [],
        reservoirRequests: [],
        arrayRequests: [],
        searchRequests: [],
      };
      URL.createObjectURL = (blob) => {
        if (blob instanceof Blob) {
          void blob.text().then((text) => {
            window.__largeRddmsTest.csvText = text;
          });
        }
        return "blob:large-rddms-csv";
      };
      const captureCopiedText = async (text) => {
        window.__largeRddmsTest.copiedText = text;
      };
      try {
        if (navigator.clipboard) {
          navigator.clipboard.writeText = captureCopiedText;
        } else {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: captureCopiedText },
          });
        }
      } catch {
        // Clipboard interception is only for asserting the copy interaction.
      }

      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/api/osdu/config")) {
          return new Response(JSON.stringify({ configured: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/osdu/kinds")) {
          return new Response(JSON.stringify({ kinds: [] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/osdu/search")) {
          window.__largeRddmsTest.searchRequests.push(url);
          return new Response(JSON.stringify({
            results: [{
              id: recordId,
              kind: "resqml20.obj_Grid2dRepresentation",
              data: { Name: "Large RDDMS response browser regression fixture" },
            }],
            totalCount: 1,
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/osdu/records/")) {
          window.__largeRddmsTest.recordRequests.push(url);
          return new Response(JSON.stringify(storageRecord), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/osdu/rdms/dataspaces/browser-test-dataspace/resources/") && url.includes("/arrays?")) {
          window.__largeRddmsTest.arrayRequests.push(url);
          const rowCount = 12000;
          const columnCount = 10;
          return new Response(JSON.stringify({
            data: {
              dimensions: [rowCount, columnCount],
              data: Array.from({ length: rowCount * columnCount }, (_, index) => index + 0.25),
            },
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/osdu/rdms/dataspaces/browser-test-dataspace/resources/")) {
          window.__largeRddmsTest.reservoirRequests.push(url);
          return new Response(JSON.stringify(largeReservoirRecord), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return realFetch(input, init);
      };
    })();
  `;
}

async function runRecordLookupDialogBrowserCheck(): Promise<void> {
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

    await waitForUrl(`${APP_URL}/search`, "OSDU Explorer dev server for shared record lookup check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-record-lookup-${process.pid}`,
      "about:blank",
    ], {
      detached: true,
      stdio: "ignore",
    });

    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "headless Chromium for shared record lookup check");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", {
      source: recordLookupMockApiScript(),
    });
    await browser.call("Page.navigate", { url: `${APP_URL}/search` });

    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('h1')?.textContent === 'Record Search'"),
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
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('Shared lookup browser test record') ?? false"),
      "the mocked search result",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const row = [...document.querySelectorAll("tbody tr")].find((candidate) =>
        candidate.textContent?.includes("Shared lookup browser test record"));
      if (!row) throw new Error("The shared lookup search result row was not found");
      (row as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('tbody tr[data-state=\"selected\"]') !== null"),
      "the shared lookup result row to become selected",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const storage = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "Storage API");
      if (!storage) throw new Error("The shared Storage API lookup button was not found");
      (storage as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Record from Storage Service') ?? false"),
      "the shared record lookup dialog",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, "window.__recordLookupTest.recordRequests.length === 1"),
      "the mocked Storage record request",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('[role=\"dialog\"]')?.querySelector('button[aria-label=\"Open record in Reservoir DDMS\"]') !== null"),
      "the Reservoir DDMS lookup action in the shared dialog",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const ddms = document.querySelector('[role="dialog"] button[aria-label="Open record in Reservoir DDMS"]');
      if (!ddms) throw new Error("The shared Reservoir DDMS lookup button was not found");
      (ddms as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Record from Reservoir DDMS') ?? false"),
      "the shared dialog to transition to Reservoir DDMS",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, "window.__recordLookupTest.reservoirRequests.length === 1"),
      "the mocked Reservoir DDMS record request",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, `(() => {
        const labels = [...document.querySelectorAll('[role="dialog"] button')]
          .map((button) => button.getAttribute("aria-label"));
        const lookupLabels = [
          "Open record in Storage API",
          "Search record in Search API",
          "Look up UUID in Reservoir DDMS",
          "Open record in Reservoir DDMS",
          "Search Wellbore DDMS",
        ];
        return lookupLabels.every((label) => !labels.includes(label))
          && labels.includes("Get array data from Reservoir DDMS");
      })()`),
      "the Reservoir DDMS toolbar actions to be filtered in the shared dialog",
    );

    assert.equal(
      await evaluate<boolean>(browser, `(() => {
        const labels = [...document.querySelectorAll('[role="dialog"] button')]
          .map((button) => button.getAttribute("aria-label"));
        const lookupLabels = [
          "Open record in Storage API",
          "Search record in Search API",
          "Look up UUID in Reservoir DDMS",
          "Open record in Reservoir DDMS",
          "Search Wellbore DDMS",
        ];
        return lookupLabels.every((label) => !labels.includes(label))
          && labels.includes("Get array data from Reservoir DDMS");
      })()`),
      true,
      "the shared Reservoir DDMS response should hide four lookup controls and keep array data",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const arrayData = document.querySelector('[role="dialog"] button[aria-label="Get array data from Reservoir DDMS"]');
      if (!arrayData) throw new Error("The shared Reservoir array-data button was not found");
      (arrayData as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "window.__recordLookupTest.arrayRequests.length === 1"),
      "the mocked Reservoir array-data request",
    );
    assert.equal(
      await evaluate<boolean>(browser, `decodeURIComponent(window.__recordLookupTest.arrayRequests[0]).includes("path=/resqml20/uuid-root/points_patch0")`),
      true,
      "array data should use the HDF path from the displayed Reservoir response",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('Array Data — Reservoir DDMS') ?? false"),
      "the shared Reservoir array-data overlay",
    );
    assert.equal(
      await evaluate<boolean>(browser, `(() => {
        const text = document.body?.innerText ?? "";
        return text.includes("2 rows × 24 cols · [2, 24]")
          && text.includes("1")
          && text.includes("48");
      })()`),
      true,
      "the shared Grid2d array-data overlay should render a wide multi-column response",
    );
    assert.equal(
      await evaluate<boolean>(browser, `(() => {
        const scrollbar = document.querySelector('[aria-label="Horizontal array table scrollbar"]');
        const tableViewport = scrollbar?.nextElementSibling;
        if (!scrollbar || !tableViewport) return false;
        const rect = scrollbar.getBoundingClientRect();
        return rect.top >= 0
          && rect.bottom <= window.innerHeight
          && scrollbar.scrollWidth > scrollbar.clientWidth
          && scrollbar.clientWidth > 0
          && tableViewport.scrollWidth > tableViewport.clientWidth;
      })()`),
      true,
      "the wide array-data table should expose an always-reachable horizontal scrollbar",
    );
    assert.equal(
      await evaluate<boolean>(browser, `(() => {
        const scrollbar = document.querySelector('[aria-label="Horizontal array table scrollbar"]');
        const tableViewport = scrollbar?.nextElementSibling;
        if (!scrollbar || !tableViewport) throw new Error("The synchronized array table scroll containers were not found");
        const topTarget = Math.floor((scrollbar.scrollWidth - scrollbar.clientWidth) / 2);
        scrollbar.scrollLeft = topTarget;
        scrollbar.dispatchEvent(new Event("scroll", { bubbles: true }));
        const topToTableSynced = tableViewport.scrollLeft === topTarget;
        const tableTarget = tableViewport.scrollWidth - tableViewport.clientWidth;
        tableViewport.scrollLeft = tableTarget;
        tableViewport.dispatchEvent(new Event("scroll", { bubbles: true }));
        return topToTableSynced && scrollbar.scrollLeft === tableTarget;
      })()`),
      true,
      "the array-data table scrollbars should remain synchronized in both directions",
    );
    const stickyRowCheck = await evaluate<{
      pass: boolean;
      scrollLeft: number;
      viewport: { left: number; right: number };
      rows: Array<{
        index: string | null;
        label: string;
        firstValue: string;
        left: number;
        right: number;
      }>;
    }>(browser, `(() => {
        const scrollbar = document.querySelector('[aria-label="Horizontal array table scrollbar"]');
        const tableViewport = scrollbar?.nextElementSibling;
        const table = document.querySelector('[aria-label="Array data table"]');
        if (!(tableViewport instanceof HTMLElement) || !(table instanceof HTMLTableElement)) {
          throw new Error("The array-data table viewport or table was not found");
        }

        tableViewport.scrollLeft = tableViewport.scrollWidth - tableViewport.clientWidth;
        tableViewport.dispatchEvent(new Event("scroll", { bubbles: true }));

        const viewportRect = tableViewport.getBoundingClientRect();
        const rows = [...table.tBodies[0]?.rows ?? []];
        const rowDetails = rows.map((row, rowIndex) => {
          const label = row.querySelector("[data-array-row-label]");
          const labelRect = label.getBoundingClientRect();
          return {
            index: row.getAttribute("data-array-row-index"),
            label: label?.textContent?.trim() ?? "",
            firstValue: row.cells[1]?.textContent?.trim() ?? "",
            left: labelRect.left,
            right: labelRect.right,
          };
        });
        const labelsStayVisible = rowDetails.every((row) => {
          return row.left >= viewportRect.left - 1
            && row.left <= viewportRect.left + 1
            && row.right <= viewportRect.right + 1;
        });
        const labelsMatchRows = rowDetails.every((row, rowIndex) => {
          return row.index === String(rowIndex)
            && row.label === String(rowIndex)
            && row.firstValue === String(rowIndex * 24 + 1);
        });
        return {
          pass: tableViewport.scrollLeft > 0 && labelsStayVisible && labelsMatchRows,
          scrollLeft: tableViewport.scrollLeft,
          viewport: { left: viewportRect.left, right: viewportRect.right },
          rows: rowDetails,
        };
      })()`);
    assert.equal(
      stickyRowCheck.pass,
      true,
      `row labels should stay at the left edge and continue to identify their rendered data rows while horizontally scrolled: ${JSON.stringify(stickyRowCheck)}`,
    );

    await evaluate<void>(browser, browserFunction(() => {
      const close = document.querySelector('[role="dialog"] button[aria-label="Close"]');
      if (!close) throw new Error("The shared array-data close button was not found");
      (close as HTMLElement).click();
      window.__recordLookupTest.forceArrayError = true;
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('Record from Reservoir DDMS') ?? false"),
      "the shared dialog after closing array data",
    );
    await evaluate<void>(browser, browserFunction(() => {
      const arrayData = document.querySelector('[role="dialog"] button[aria-label="Get array data from Reservoir DDMS"]');
      if (!arrayData) throw new Error("The shared Reservoir array-data button was not found after closing the overlay");
      (arrayData as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "window.__recordLookupTest.arrayRequests.length === 2"),
      "the mocked failing Reservoir array-data request",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('Mocked Reservoir array data failed') ?? false"),
      "the shared array-data error",
    );
    await evaluate<void>(browser, browserFunction(() => {
      const copy = document.querySelector('[role="dialog"] button[aria-label="Copy error"]');
      if (!copy) throw new Error("The array-data copy error button was not found");
      (copy as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "window.__recordLookupTest.copiedText === 'Mocked Reservoir array data failed'"),
      "the array-data error to be copied",
    );

    console.log("Shared record lookup browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    terminateProcess(appServer);
  }
}

async function runLargeRddmsResponseBrowserCheck(): Promise<void> {
  let appServer: ChildProcess | undefined;
  let chromium: ChildProcess | undefined;
  let browser: CdpClient | undefined;
  const ACTION_TIMEOUT_MS = 5_000;
  // Leave room for occasional host scheduling spikes while still failing on a
  // sustained multi-second main-thread freeze.
  const LONG_TASK_BUDGET_MS = 3_000;

  const measureAction = async (
    label: string,
    action: (...args: any[]) => unknown,
    ...args: unknown[]
  ): Promise<void> => {
    const result = await evaluateWithTimeout<{
      durationMs: number;
      heartbeatCount: number;
      longTaskCount: number;
      longTaskDurationMs: number;
      longTaskObserverSupported: boolean;
    }>(browser!, timedBrowserAction(action, ...args), ACTION_TIMEOUT_MS);
    assert.ok(
      result.longTaskObserverSupported,
      `${label} could not measure browser long tasks`,
    );
    assert.ok(
      result.longTaskDurationMs < LONG_TASK_BUDGET_MS,
      `${label} blocked the browser for ${result.longTaskDurationMs.toFixed(1)}ms across ${result.longTaskCount} long task(s)`,
    );
    assert.ok(
      result.durationMs < ACTION_TIMEOUT_MS,
      `${label} did not settle within ${ACTION_TIMEOUT_MS}ms (wall-clock duration ${result.durationMs.toFixed(1)}ms; ${result.heartbeatCount} responsiveness heartbeats)`,
    );
  };

  try {
    appServer = spawn("pnpm", ["--filter", "@workspace/osdu-explorer", "run", "dev"], {
      cwd: process.cwd(),
      env: { ...process.env, BASE_PATH: "/", PORT: String(APP_PORT) },
      detached: true,
      stdio: "ignore",
    });

    await waitForUrl(`${APP_URL}/search`, "OSDU Explorer dev server for large RDDMS response check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-large-rddms-${process.pid}`,
      "about:blank",
    ], {
      detached: true,
      stdio: "ignore",
    });

    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "headless Chromium for large RDDMS response check");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", {
      source: largeRddmsMockApiScript(),
    });
    await browser.call("Page.navigate", { url: `${APP_URL}/search` });

    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('h1')?.textContent === 'Record Search'"),
      "Record Search to render for the large RDDMS response check",
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
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('Large RDDMS response browser regression fixture') ?? false"),
      "the large RDDMS search result",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const row = [...document.querySelectorAll("tbody tr")].find((candidate) =>
        candidate.textContent?.includes("Large RDDMS response browser regression fixture"));
      if (!row) throw new Error("The large RDDMS search result row was not found");
      (row as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('tbody tr[data-state=\"selected\"]') !== null"),
      "the large RDDMS result row to become selected",
    );
    await evaluate<void>(browser, browserFunction(() => {
      const storage = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "Storage API");
      if (!storage) throw new Error("The large RDDMS Storage API lookup button was not found");
      (storage as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Record from Storage Service') ?? false"),
      "the large RDDMS Storage response dialog",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, "window.__largeRddmsTest.recordRequests.length === 1"),
      "the mocked large Storage record request",
    );
    await evaluate<void>(browser, browserFunction(() => {
      const ddms = document.querySelector('[role="dialog"] button[aria-label="Open record in Reservoir DDMS"]');
      if (!ddms) throw new Error("The large RDDMS lookup button was not found");
      (ddms as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Record from Reservoir DDMS') ?? false"),
      "the large Reservoir DDMS response dialog",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, "window.__largeRddmsTest.reservoirRequests.length === 1"),
      "the mocked large Reservoir DDMS request",
    );
    assert.equal(
      await evaluate<boolean>(browser, `(() => {
        const text = document.querySelector('[role="dialog"]')?.textContent ?? "";
        return text.includes("Large RDDMS response browser regression fixture")
          && text.includes("large-rddms-response-browser-regression")
          && document.querySelector('[role="dialog"] button[aria-label="Get array data from Reservoir DDMS"]') !== null;
      })()`),
      true,
      "the large nested RDDMS response should be displayed with its array-data action",
    );

    await measureAction("copy", (label) => {
      const button = document.querySelector(`[role="dialog"] button[aria-label="${label}"]`);
      if (!button) throw new Error(`The ${label} toolbar button was not found`);
      (button as HTMLElement).click();
    }, "Copy");
    await waitFor(
      () => evaluate<boolean>(browser!, "window.__largeRddmsTest.copiedText.includes('large-rddms-response-browser-regression')"),
      "the large RDDMS response to be copied",
    );

    await measureAction("opening search", (label) => {
      const button = document.querySelector(`[role="dialog"] button[aria-label="${label}"]`);
      if (!button) throw new Error(`The ${label} toolbar button was not found`);
      (button as HTMLElement).click();
    }, "Search");
    await measureAction("searching", (value) => {
      const input = document.querySelector('[role="dialog"] input[placeholder="Find…"]') as HTMLInputElement | null;
      if (!input) throw new Error("The large RDDMS search input was not found");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) throw new Error("The large RDDMS search input setter was not found");
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, "rddms-response");
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('1 / 1') ?? false"),
      "the large RDDMS search result",
    );
    await measureAction("closing search", (label) => {
      const button = document.querySelector(`[role="dialog"] button[aria-label="${label}"]`);
      if (!button) throw new Error(`The ${label} toolbar button was not found`);
      (button as HTMLElement).click();
    }, "Close search");

    await measureAction("switching to raw view", (label) => {
      const button = document.querySelector(`[role="dialog"] button[aria-label="${label}"]`);
      if (!button) throw new Error(`The ${label} toolbar button was not found`);
      (button as HTMLElement).click();
    }, "Raw view");
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('[role=\"dialog\"] pre') !== null"),
      "the large RDDMS raw view",
    );
    await measureAction("switching to tree view", (label) => {
      const button = document.querySelector(`[role="dialog"] button[aria-label="${label}"]`);
      if (!button) throw new Error(`The ${label} toolbar button was not found`);
      (button as HTMLElement).click();
    }, "Tree view");
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('[role=\"dialog\"] [data-json-content=\"true\"]') !== null"),
      "the large RDDMS tree view",
    );

    await measureAction("opening array data", (label) => {
      const button = document.querySelector(`[role="dialog"] button[aria-label="${label}"]`);
      if (!button) throw new Error(`The ${label} toolbar button was not found`);
      (button as HTMLElement).click();
    }, "Get array data from Reservoir DDMS");
    await waitFor(
      () => evaluate<boolean>(browser!, "window.__largeRddmsTest.arrayRequests.length === 1"),
      "the large RDDMS array-data request",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('Array Data — Reservoir DDMS') ?? false"),
      "the large RDDMS array-data overlay",
    );
    assert.equal(
      await evaluate<boolean>(browser, "document.body?.innerText.includes('12,000 rows × 10 cols · [12000, 10]') ?? false"),
      true,
      "the large RDDMS array-data overlay should render",
    );
    assert.deepEqual(
      await evaluate<string[]>(browser, `(() => {
        const viewport = document.querySelector('[aria-label="Array data table viewport"]');
        return [...(viewport?.querySelectorAll("thead th") ?? [])]
          .slice(1)
          .map((header) => header.textContent?.trim() ?? "");
      })()`),
      ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
      "array data columns should use compact numeric labels",
    );
    const stickyHeaderState = await evaluate<{
      headerPosition: string;
      headerTop: number;
      viewportTop: number;
      viewportBottom: number;
      horizontalAlignment: number;
    }>(browser, `(() => {
      const viewport = document.querySelector('[aria-label="Array data table viewport"]');
      const headerCell = viewport?.querySelector("thead th:nth-child(2)");
      const firstDataCell = viewport?.querySelector("tbody tr:first-child td:nth-child(2)");
      if (!(viewport instanceof HTMLElement) || !(headerCell instanceof HTMLElement) || !(firstDataCell instanceof HTMLElement)) {
        throw new Error("The array table viewport or cells were not found");
      }
      viewport.scrollTop = Math.min(400, viewport.scrollHeight);
      viewport.scrollLeft = Math.min(120, viewport.scrollWidth);
      const viewportRect = viewport.getBoundingClientRect();
      const headerRect = headerCell.getBoundingClientRect();
      const dataRect = firstDataCell.getBoundingClientRect();
      return {
        headerPosition: getComputedStyle(headerCell).position,
        headerTop: headerRect.top,
        viewportTop: viewportRect.top,
        viewportBottom: viewportRect.bottom,
        horizontalAlignment: Math.abs(headerRect.left - dataRect.left),
      };
    })()`);
    assert.equal(stickyHeaderState.headerPosition, "sticky", "array column headers should use sticky positioning");
    assert.ok(
      stickyHeaderState.headerTop >= stickyHeaderState.viewportTop - 1
        && stickyHeaderState.headerTop < stickyHeaderState.viewportBottom,
      "array column headers should remain visible after vertical scrolling",
    );
    assert.ok(
      stickyHeaderState.horizontalAlignment <= 1,
      `array column headers should stay aligned with data columns after horizontal scrolling (delta ${stickyHeaderState.horizontalAlignment}px)`,
    );

    await browser.call("Emulation.setDeviceMetricsOverride", {
      width: 480,
      height: 360,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(
      () => evaluate<boolean>(browser!, "window.innerWidth === 480 && window.innerHeight === 360"),
      "the compact browser viewport",
    );
    const compactStickyHeaderState = await evaluate<{
      headerPosition: string;
      headerTop: number;
      viewportTop: number;
      viewportBottom: number;
      horizontalAlignment: number;
      hasHorizontalOverflow: boolean;
    }>(browser, `(() => {
      const viewport = document.querySelector('[aria-label="Array data table viewport"]');
      const headerCell = viewport?.querySelector("thead th:nth-child(2)");
      const firstDataCell = viewport?.querySelector("tbody tr:first-child td:nth-child(2)");
      if (!(viewport instanceof HTMLElement) || !(headerCell instanceof HTMLElement) || !(firstDataCell instanceof HTMLElement)) {
        throw new Error("The compact array table viewport or cells were not found");
      }
      viewport.scrollTop = Math.min(400, viewport.scrollHeight);
      viewport.scrollLeft = Math.min(120, viewport.scrollWidth);
      const viewportRect = viewport.getBoundingClientRect();
      const headerRect = headerCell.getBoundingClientRect();
      const dataRect = firstDataCell.getBoundingClientRect();
      return {
        headerPosition: getComputedStyle(headerCell).position,
        headerTop: headerRect.top,
        viewportTop: viewportRect.top,
        viewportBottom: viewportRect.bottom,
        horizontalAlignment: Math.abs(headerRect.left - dataRect.left),
        hasHorizontalOverflow: viewport.scrollWidth > viewport.clientWidth,
      };
    })()`);
    assert.equal(compactStickyHeaderState.headerPosition, "sticky", "compact array headers should use sticky positioning");
    assert.ok(
      compactStickyHeaderState.headerTop >= compactStickyHeaderState.viewportTop - 1
        && compactStickyHeaderState.headerTop < compactStickyHeaderState.viewportBottom,
      "compact array headers should remain visible after vertical scrolling",
    );
    assert.equal(compactStickyHeaderState.hasHorizontalOverflow, true, "compact array data should retain horizontal overflow");
    assert.ok(
      compactStickyHeaderState.horizontalAlignment <= 1,
      `compact array headers should stay aligned after horizontal scrolling (delta ${compactStickyHeaderState.horizontalAlignment}px)`,
    );

    const csvResult = await evaluateWithTimeout<{
      durationMs: number;
      heartbeatCount: number;
    }>(
      browser,
      timedBrowserAction((label) => {
        const button = document.querySelector(`[role="dialog"] button[aria-label="${label}"]`);
        if (!button) throw new Error(`The ${label} button was not found`);
        (button as HTMLElement).click();
      }, "Download CSV"),
      10_000,
    );
    assert.ok(csvResult.durationMs < 5_000, `large CSV download took ${csvResult.durationMs.toFixed(1)}ms`);
    await waitFor(
      () => evaluate<boolean>(browser!, "window.__largeRddmsTest.csvText.split('\\n').length === 12001"),
      "the large CSV export to finish",
      10_000,
    );
    assert.equal(
      await evaluate<boolean>(browser, `(() => {
        const rows = window.__largeRddmsTest.csvText.split("\\n");
        return rows[0] === "row,0,1,2,3,4,5,6,7,8,9"
          && rows[1] === "0,0.25,1.25,2.25,3.25,4.25,5.25,6.25,7.25,8.25,9.25"
          && rows[12000] === "11999,119990.25,119991.25,119992.25,119993.25,119994.25,119995.25,119996.25,119997.25,119998.25,119999.25";
      })()`),
      true,
      "the large CSV export should contain the header, first row, and final row",
    );
    assert.ok(csvResult.heartbeatCount > 0, "large CSV download should yield to the browser");

    console.log("Large RDDMS response browser check passed.");
  } finally {
    browser?.close();
    terminateProcess(chromium);
    terminateProcess(appServer);
  }
}

async function runReservoirTableBrowserCheck(): Promise<void> {
  let appServer: ChildProcess | undefined;
  let chromium: ChildProcess | undefined;
  let browser: CdpClient | undefined;

  const recordTable = () => `
    [...document.querySelectorAll("table")].at(-1)
  `;
  const recordRows = () => `
    (() => {
      const table = ${recordTable()};
      return table ? [...table.querySelectorAll("tbody tr")] : [];
    })()
  `;
  const setInputValue = (placeholder: string, value: string) => browserFunction((expectedPlaceholder, nextValue) => {
    const input = [...document.querySelectorAll("input")]
      .find((candidate) => candidate.getAttribute("placeholder") === expectedPlaceholder) as HTMLInputElement | undefined;
    if (!input) throw new Error("Reservoir table input was not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Reservoir table input setter was not found");
    setter.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, placeholder, value);

  try {
    appServer = spawn("pnpm", ["--filter", "@workspace/osdu-explorer", "run", "dev"], {
      cwd: process.cwd(),
      env: { ...process.env, BASE_PATH: "/", PORT: String(APP_PORT) },
      detached: true,
      stdio: "ignore",
    });

    await waitForUrl(`${APP_URL}/reservoir-dms`, "OSDU Explorer dev server for Reservoir table check");

    chromium = spawn(CHROMIUM_PATH, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/osdu-reservoir-table-${process.pid}`,
      "about:blank",
    ], {
      detached: true,
      stdio: "ignore",
    });

    await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`, "headless Chromium for Reservoir table check");
    const target = await getPageTarget();
    browser = await CdpClient.connect(target.webSocketDebuggerUrl!);
    await browser.call("Runtime.enable");
    await browser.call("Page.enable");
    await browser.call("Page.addScriptToEvaluateOnNewDocument", {
      source: reservoirTableMockApiScript(),
    });
    await browser.call("Page.navigate", { url: `${APP_URL}/reservoir-dms` });

    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('Reservoir DDMS Data') ?? false"),
      "Reservoir DDMS page to render",
    );
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('browser-test-dataspace') ?? false"),
      "the mocked Reservoir dataspace to load",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "Fetch Resources");
      if (!button) throw new Error("Fetch Resources button was not found");
      (button as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('Grid2dRepresentation') ?? false"),
      "the mocked Reservoir resource to load",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const row = [...document.querySelectorAll("table:first-of-type tbody tr")]
        .find((candidate) => candidate.textContent?.includes("Grid2dRepresentation"));
      if (!row) throw new Error("Reservoir resource row was not found");
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('of 75 records') ?? false"),
      "the Reservoir records table to render",
    );
    assert.equal(
      await evaluate<number>(browser, recordRows() + ".length"),
      50,
      "the records table should use its default 50-row page size",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const table = [...document.querySelectorAll("table")].at(-1);
      const nameHeader = [...(table?.querySelectorAll("thead th") ?? [])]
        .find((candidate) => candidate.textContent?.includes("Name"));
      if (!nameHeader) throw new Error("Name column header was not found");
      (nameHeader as HTMLElement).click();
    }));
    await evaluate<void>(browser, browserFunction(() => {
      const table = [...document.querySelectorAll("table")].at(-1);
      const nameHeader = [...(table?.querySelectorAll("thead th") ?? [])]
        .find((candidate) => candidate.textContent?.includes("Name"));
      if (!nameHeader) throw new Error("Name column header was not found after first sort");
      (nameHeader as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, recordRows() + ".length === 50"),
      "the records table rows to remain rendered after sorting",
    );
    const sortedFirstRow = await evaluate<string>(
      browser,
      recordRows() + "[0]?.textContent ?? ''",
    );
    assert.equal(
      sortedFirstRow.includes("Record 075"),
      true,
      `the records table should sort descending by name (first row: ${sortedFirstRow})`,
    );

    await evaluate<void>(browser, setInputValue("Filter by UUID, name, creator, or date…", "creator-1"));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('of 25 records') ?? false"),
      "the records filter to reduce the visible dataset",
    );
    assert.equal(
      await evaluate<number>(browser, recordRows() + ".length"),
      25,
      "filtering should show only the matching records",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const clear = document.querySelector('button[aria-label="Clear records filter"]');
      if (!clear) throw new Error("Clear records filter button was not found");
      (clear as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('of 75 records') ?? false"),
      "the records filter to clear",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const trigger = [...document.querySelectorAll('[role="combobox"]')]
        .find((candidate) => candidate.textContent?.trim() === "50");
      if (!trigger) throw new Error("Records page-size selector was not found");
      (trigger as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('[role=\"option\"]')?.textContent?.trim() === '25'"),
      "the 25-row page-size option",
    );
    await evaluate<void>(browser, browserFunction(() => {
      const option = [...document.querySelectorAll('[role="option"]')]
        .find((candidate) => candidate.textContent?.trim() === "25");
      if (!option) throw new Error("25-row page-size option was not found");
      (option as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('1–25 / 75') ?? false"),
      "the records table to switch to 25 rows per page",
    );
    assert.equal(
      await evaluate<number>(browser, recordRows() + ".length"),
      25,
      "the page-size selector should reduce the visible page",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const next = document.querySelector('button[aria-label="Next records page"]');
      if (!next) throw new Error("Next records page button was not found");
      (next as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('26–50 / 75') ?? false"),
      "the second records page",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const row = [...document.querySelectorAll("table")].at(-1)?.querySelector("tbody tr");
      if (!row) throw new Error("A Reservoir record row was not found");
      (row as HTMLElement).click();
    }));
    assert.equal(
      await evaluate<boolean>(browser, recordRows() + "[0]?.getAttribute('data-state') === 'selected'"),
      true,
      "a Reservoir record row should be selectable",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const columns = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim().startsWith("Columns"));
      if (!columns) throw new Error("Reservoir Columns button was not found");
      columns.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      (columns as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "[...document.querySelectorAll('[role=\"menuitemcheckbox\"]')].some((item) => item.textContent?.includes('Creator'))"),
      "the Reservoir column menu",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const table = [...document.querySelectorAll("table")].at(-1);
      const headers = [...(table?.querySelectorAll("thead th") ?? [])];
      const nameHeader = headers.find((candidate) => candidate.textContent?.includes("Name"));
      const uuidHeader = headers.find((candidate) => candidate.textContent?.includes("UUID"));
      const source = nameHeader?.querySelector("[draggable='true']");
      if (!source || !uuidHeader) throw new Error("Reservoir draggable column headers were not found");
      const transfer = new DataTransfer();
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
      uuidHeader.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: transfer }));
      uuidHeader.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
      source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, recordTable() + "?.querySelector('thead th')?.textContent?.includes('Name') ?? false"),
      "the reordered Reservoir columns",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const creator = [...document.querySelectorAll('[role="menuitemcheckbox"]')]
        .find((candidate) => candidate.textContent?.trim() === "Creator");
      if (!creator) throw new Error("Creator column menu item was not found");
      (creator as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, recordTable() + "?.querySelectorAll('thead th').length === 4"),
      "the Creator column to hide",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const table = [...document.querySelectorAll("table")].at(-1);
      const nameHeader = [...(table?.querySelectorAll("thead th") ?? [])]
        .find((candidate) => candidate.textContent?.includes("Name"));
      const separator = nameHeader?.querySelector('[role="separator"]');
      if (!separator) throw new Error("Name column resize handle was not found");
      separator.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100 }));
      window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 180 }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 180 }));
    }));
    assert.equal(
      await evaluate<boolean>(browser, `(() => {
        const visible = JSON.parse(localStorage.getItem("osdu-reservoir-records:col-visible") ?? "{}");
        const order = JSON.parse(localStorage.getItem("osdu-reservoir-records:col-order") ?? "[]");
        const widths = JSON.parse(localStorage.getItem("osdu-reservoir-records:col-widths") ?? "{}");
        return visible.creator === false && order[0] === "name" && widths.name > 220;
      })()`),
      true,
      "column visibility, order, and resize should persist",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const fullscreen = document.querySelector('button[aria-label="Full screen records table"]');
      if (!fullscreen) throw new Error("Full screen records table button was not found");
      (fullscreen as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Reservoir Records Full Screen') ?? false"),
      "the Reservoir records fullscreen dialog",
    );
    assert.equal(
      await evaluate<boolean>(browser, "document.querySelector('[role=\"dialog\"] table') !== null"),
      true,
      "fullscreen mode should contain the records table",
    );
    await evaluate<void>(browser, browserFunction(() => {
      const exit = document.querySelector('button[aria-label="Exit full screen"]');
      if (!exit) throw new Error("Exit full screen button was not found");
      (exit as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.querySelector('[role=\"dialog\"]') === null"),
      "the Reservoir records fullscreen dialog to close",
    );

    await evaluate<void>(browser, browserFunction(() => {
      const row = [...document.querySelectorAll("table")].at(-1)?.querySelector("tbody tr");
      if (!row) throw new Error("A Reservoir record row was not found for detail");
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('resqml20.obj_Grid2dRepresentation / uuid-') ?? false"),
      "the Reservoir record JSON viewer",
    );
    assert.equal(
      await evaluate<boolean>(browser, `(() => {
        const labels = [...document.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
        const lookupLabels = [
          "Open record in Storage API",
          "Search record in Search API",
          "Look up UUID in Reservoir DDMS",
          "Open record in Reservoir DDMS",
          "Search Wellbore DDMS",
        ];
        return lookupLabels.every((label) => !labels.includes(label))
          && labels.includes("Get array data from Reservoir DDMS");
      })()`),
      true,
      "a Reservoir record should hide cross-service lookups and keep the table-data action",
    );
    assert.equal(
      await evaluate<number>(browser, "window.__reservoirTableTest.detailRequests.length"),
      1,
      "double-clicking a record should fetch its detail JSON",
    );

    await browser.call("Page.navigate", { url: `${APP_URL}/reservoir-dms` });
    await waitFor(
      () => evaluate<boolean>(browser!, `(() => {
        const fetchResources = [...document.querySelectorAll("button")]
          .find((candidate) => candidate.textContent?.trim() === "Fetch Resources");
        const dataspaceTrigger = document.querySelector('[role="combobox"]');
        return document.readyState === "complete"
          && location.pathname === "/reservoir-dms"
          && document.body?.innerText.includes("Reservoir DDMS Data")
          && fetchResources !== undefined
          && dataspaceTrigger?.textContent?.includes("browser-test-dataspace")
          && fetchResources instanceof HTMLButtonElement
          && !fetchResources.disabled
          && window.__reservoirTableTest?.detailRequests.length === 0;
      })()`),
      "a fresh Reservoir DDMS document with its selected dataspace to render after reload",
    );
    await evaluate<void>(browser, browserFunction(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "Fetch Resources");
      if (!button) throw new Error("Fetch Resources button was not found after reload");
      (button as HTMLElement).click();
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('Grid2dRepresentation') ?? false"),
      "the mocked Reservoir resource after reload",
    );
    await evaluate<void>(browser, browserFunction(() => {
      const row = [...document.querySelectorAll("table:first-of-type tbody tr")]
        .find((candidate) => candidate.textContent?.includes("Grid2dRepresentation"));
      if (!row) throw new Error("Reservoir resource row was not found after reload");
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    }));
    await waitFor(
      () => evaluate<boolean>(browser!, "document.body?.innerText.includes('1–25 / 75') ?? false"),
      "the persisted Reservoir page size after reload",
    );
    assert.equal(
      await evaluate<boolean>(browser, recordTable() + "?.querySelector('thead th')?.textContent?.includes('Name') ?? false"),
      true,
      "the reordered Name column should remain first after reload",
    );
    assert.equal(
      await evaluate<boolean>(browser, recordTable() + "?.querySelectorAll('thead th').length === 4"),
      true,
      "the hidden Creator column should remain hidden after reload",
    );

    console.log("Reservoir table browser check passed.");
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
await runRecordLookupDialogBrowserCheck();
await runLargeRddmsResponseBrowserCheck();
await runReservoirTableBrowserCheck();
