export interface DashboardKindOption {
  value: string;
  count: number;
}

export interface DashboardSearchPage<T> {
  results: T[];
  totalCount: number;
}

export interface DashboardRowsProgress {
  completedPages: number;
  currentPage: number;
  totalPages: number | null;
  rowsFetched: number;
  totalCount: number | null;
}

export interface DashboardRowsFetchErrorDetails {
  page: number;
  offset: number;
  rowsFetched: number;
}

export class DashboardRowsFetchError extends Error {
  readonly page: number;
  readonly offset: number;
  readonly rowsFetched: number;
  readonly cause: unknown;

  constructor(details: DashboardRowsFetchErrorDetails, cause: unknown) {
    super("The dashboard Kind scan could not load a page.");
    this.name = "DashboardRowsFetchError";
    this.page = details.page;
    this.offset = details.offset;
    this.rowsFetched = details.rowsFetched;
    this.cause = cause;
  }
}

export interface CollectDashboardRowsOptions {
  pageSize?: number;
  signal?: AbortSignal;
  onProgress?: (progress: DashboardRowsProgress) => void;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason ?? Object.assign(new Error("The dashboard Kind scan was canceled."), {
      name: "AbortError",
    });
  }
}

export async function collectDashboardRows<T>(
  fetchPage: (offset: number) => Promise<DashboardSearchPage<T>>,
  options: CollectDashboardRowsOptions = {},
): Promise<T[]> {
  const allRows: T[] = [];
  let nextOffset = 0;
  let totalCount = 0;
  let completedPages = 0;
  let pageSize = options.pageSize ?? 0;

  const reportProgress = () => {
    const totalPages = totalCount > 0 && pageSize > 0
      ? Math.ceil(totalCount / pageSize)
      : null;
    options.onProgress?.({
      completedPages,
      currentPage: completedPages + 1,
      totalPages,
      rowsFetched: allRows.length,
      totalCount: totalCount || null,
    });
  };

  do {
    throwIfAborted(options.signal);
    reportProgress();
    let page: DashboardSearchPage<T>;
    try {
      page = await fetchPage(nextOffset);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new DashboardRowsFetchError({
        page: completedPages + 1,
        offset: nextOffset,
        rowsFetched: allRows.length,
      }, error);
    }
    throwIfAborted(options.signal);
    allRows.push(...page.results);
    totalCount = page.totalCount;
    completedPages += 1;
    if (pageSize <= 0 && page.results.length > 0) {
      pageSize = page.results.length;
    }
    reportProgress();

    if (page.results.length === 0) break;
    nextOffset += page.results.length;
  } while (nextOffset < totalCount);

  return allRows;
}

export function getDashboardKindOptions(
  rows: Array<{ kind: string }>,
): DashboardKindOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.kind === "—") continue;
    counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function filterDashboardRows<T extends { kind: string }>(
  rows: T[],
  selectedKinds: string[],
): T[] {
  if (selectedKinds.length === 0) return rows;
  return rows.filter((row) => selectedKinds.includes(row.kind));
}

export function paginateDashboardRows<T>(
  rows: T[],
  offset: number,
  limit: number,
): T[] {
  return rows.slice(offset, offset + limit);
}