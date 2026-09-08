import assert from "node:assert/strict";
import {
  collectDashboardRows,
  DashboardRowsFetchError,
  filterDashboardRows,
  getDashboardKindOptions,
  paginateDashboardRows,
} from "./dashboard-kind-filter";

interface CheckRow {
  id: string;
  kind: string;
}

const firstServerPage: CheckRow[] = [
  { id: "record-a-1", kind: "type-a" },
  { id: "record-a-2", kind: "type-a" },
];
const secondServerPage: CheckRow[] = [
  { id: "record-b-1", kind: "type-b" },
  { id: "record-b-2", kind: "type-b" },
];
const serverPages = [firstServerPage, secondServerPage];
const requestedOffsets: number[] = [];
const progress: Array<{
  completedPages: number;
  currentPage: number;
  totalPages: number | null;
  rowsFetched: number;
  totalCount: number | null;
}> = [];

const allRows = await collectDashboardRows(
  async (offset) => {
    requestedOffsets.push(offset);
    return {
      results: serverPages[offset / 2] ?? [],
      totalCount: 4,
    };
  },
  {
    pageSize: 2,
    onProgress: (nextProgress) => progress.push(nextProgress),
  },
);

assert.deepEqual(requestedOffsets, [0, 2]);
assert.deepEqual(progress, [
  { completedPages: 0, currentPage: 1, totalPages: null, rowsFetched: 0, totalCount: null },
  { completedPages: 1, currentPage: 2, totalPages: 2, rowsFetched: 2, totalCount: 4 },
  { completedPages: 1, currentPage: 2, totalPages: 2, rowsFetched: 2, totalCount: 4 },
  { completedPages: 2, currentPage: 3, totalPages: 2, rowsFetched: 4, totalCount: 4 },
]);
assert.deepEqual(getDashboardKindOptions(allRows), [
  { value: "type-a", count: 2 },
  { value: "type-b", count: 2 },
]);

const typeBRows = filterDashboardRows(allRows, ["type-b"]);
assert.deepEqual(paginateDashboardRows(typeBRows, 1, 1), [secondServerPage[1]]);

const failedScan = collectDashboardRows(
  async (offset) => {
    if (offset === 0) return { results: firstServerPage, totalCount: 4 };
    throw new Error("Later page unavailable");
  },
  { pageSize: 2 },
);
await assert.rejects(failedScan, (error) => {
  assert.ok(error instanceof DashboardRowsFetchError);
  assert.equal(error.page, 2);
  assert.equal(error.offset, 2);
  assert.equal(error.rowsFetched, 2);
  return true;
});

const abortController = new AbortController();
const canceledOffsets: number[] = [];
let pageStarted!: () => void;
const firstPageStarted = new Promise<void>((resolve) => {
  pageStarted = resolve;
});
let releasePage!: () => void;
const firstPage = new Promise<{ results: CheckRow[]; totalCount: number }>((resolve) => {
  releasePage = () => resolve({ results: firstServerPage, totalCount: 4 });
});
const canceledScan = collectDashboardRows(
  async (offset) => {
    canceledOffsets.push(offset);
    pageStarted();
    return firstPage;
  },
  {
    pageSize: 2,
    signal: abortController.signal,
  },
);
await firstPageStarted;
abortController.abort();
releasePage();
await assert.rejects(canceledScan);
assert.deepEqual(canceledOffsets, [0]);

// Clearing the Kind filter must use the normal server-paginated rows again.
assert.deepEqual(
  paginateDashboardRows(filterDashboardRows(firstServerPage, []), 0, 2),
  firstServerPage,
);

console.log("Dashboard Kind filter cross-page check passed.");