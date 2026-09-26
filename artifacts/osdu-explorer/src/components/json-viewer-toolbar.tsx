import { useRef, useState, useCallback, useEffect, useMemo, useLayoutEffect, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Copy,
  Check,
  ListChecks,
  TextSearch,
  X,
  ChevronUp,
  ChevronDown,
  ListTree,
  Rows3,
  Maximize2,
  ExternalLink,
  WrapText,
  ArrowLeft,
  Search,
  FileSearch2,
  DatabaseZap,
  Loader2,
  Terminal,
  Grid3x3,
  Mountain,
  Pencil,
  Download,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConsolePanel } from "@/components/console-panel";
import { WellboreDmsIcon } from "@/components/wellbore-dms-icon";
import { ReservoirDdmsIcon } from "@/components/reservoir-ddms-icon";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics";
import { useActivityProgress } from "@/components/activity-progress";
import {
  JsonTreeView,
  buildTreeMatches,
  useTreeCollapsed,
  MAX_SEARCH_MATCHES,
  type JsonValue,
  type TreeMatch,
  type TreeCollapsedState,
} from "@/components/json-tree-view";
import { Textarea } from "@/components/ui/textarea";
import type { Grid2dSurface } from "@/lib/grid2d-mesh";
import { resolveGrid2dLattice } from "@/lib/grid2d-resqml";
import { saveRdmsRecord } from "@/lib/rdms-record-save";
import { deleteRdmsRecord, getRdmsDeleteGuidance } from "@/lib/rdms-record-delete";
import {
  discoverRdmsReferencers,
  cascadeDeleteRdmsRecord,
  getRdmsCascadeGuidance,
  type RdmsReferencer,
} from "@/lib/rdms-cascade-delete";
import { saveStorageRecord } from "@/lib/storage-record-save";
import { softDeleteStorageRecord, purgeStorageRecord } from "@/lib/storage-record-delete";

// Lazy-loaded so three.js / @react-three/fiber stay out of the main bundle and
// out of the load path unless a Grid2d surface is actually visualized.
const Grid2dSurfaceView = lazy(() => import("@/components/grid2d-surface-view"));

interface JsonViewerToolbarProps {
  json: string;
  className?: string;
  storageKey?: string;
  /** Label shown in the fullscreen overlay header */
  title?: string;
  /** Internal: when true the component is already inside the fullscreen overlay */
  _isFullscreen?: boolean;
  /** When true, open directly in fullscreen (no inline view rendered) */
  defaultFullscreen?: boolean;
  /** Called when the fullscreen overlay is closed (only relevant with defaultFullscreen) */
  onFullscreenClose?: () => void;
  /** When true, hide the Storage lookup button in fullscreen mode */
  hideStorageLookup?: boolean;
  /** When true, hide the Search lookup button in fullscreen mode */
  hideSearchLookup?: boolean;
  /** When true, hide the Reservoir DDMS lookup button in fullscreen mode */
  hideDdmsLookup?: boolean;
  /** When true, hide the Wellbore DDMS lookup button in fullscreen mode */
  hideWdmsLookup?: boolean;
  /** When provided, the Search lookup button performs an RDMS lookup instead of OSDU search */
  rdmsContext?: { dataspace: string; datatype?: string; uuid?: string };
  /** Default record ID to search when this viewer is showing a Storage response */
  searchRecordId?: string;
  /** Default record ID to fetch when this viewer is showing a Search response */
  storageRecordId?: string;
  /** Controlled lookup result used to replace the active viewer payload */
  lookupResult?: JsonViewerLookupResult | null;
  /** Called when a controlled lookup result is opened or closed */
  onLookupResult?: (result: JsonViewerLookupResult | null) => void;
  /** Called after the displayed Reservoir DDMS record is deleted */
  onRecordDeleted?: () => void;
  /** Opens the existing Reservoir DDMS delete confirmation for this UUID */
  openRdmsDeleteRequestId?: string | null;
  /** Called after a controlled Reservoir DDMS delete request is handled */
  onRdmsDeleteRequestHandled?: () => void;
  /** When showing a Storage record, the currently selected version to display */
  selectedStorageVersion?: number;
  /** Called when user selects a different version of a Storage record */
  onStorageVersionSelect?: (version: number) => void;
}

interface RawMatch {
  start: number;
  end: number;
}

function buildRawSegments(text: string, matches: RawMatch[], activeIndex: number) {
  if (matches.length === 0) return [{ text, highlight: false, active: false }];
  const segments: { text: string; highlight: boolean; active: boolean }[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) {
      segments.push({ text: text.slice(cursor, m.start), highlight: false, active: false });
    }
    segments.push({ text: text.slice(m.start, m.end), highlight: true, active: i === activeIndex });
    cursor = m.end;
  });
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlight: false, active: false });
  }
  return segments;
}

type ViewMode = "tree" | "raw";
type ResponseType = "search" | "storage" | "ddms";

export interface JsonViewerLookupResult {
  responseType: ResponseType;
  json: string;
  label: string;
  storageKey?: string;
  rdmsContext?: { dataspace: string; datatype?: string; uuid?: string };
}

const RESPONSE_TITLES: Record<ResponseType, string> = {
  search: "Record from Search Service",
  storage: "Record from Storage Service",
  ddms: "Record from Reservoir DDMS",
};

const ENABLED_ICON_CLASS = "text-primary hover:text-primary";
const DISABLED_ICON_CLASS = "text-foreground disabled:text-foreground disabled:opacity-100";
const iconStateClass = (enabled: boolean) => enabled ? ENABLED_ICON_CLASS : DISABLED_ICON_CLASS;

interface SharedViewerState {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  query: string;
  onQueryChange: (q: string) => void;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OSDU_ID_EXTRACT_RE = /[a-zA-Z0-9][\w-]*:(?:master-data|reference-data|work-product-component|work-product)(?:--[\w.-]+)?:[^\s"'\[\]{},\n\\]+/g;
const OSDU_ID_RE = /^[a-zA-Z0-9][\w-]*:(?:master-data|reference-data|work-product-component|work-product)(?:--[\w.-]+)?:.+$/;

function extractFirstOsduId(text: string): string | null {
  return text.match(OSDU_ID_EXTRACT_RE)?.[0]?.replace(/:+$/, "") ?? null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function selectionCoversTarget(selection: Selection | null, target: HTMLElement | null): boolean {
  if (!selection || !target || selection.rangeCount === 0 || selection.isCollapsed) return false;
  const selectionRange = selection.getRangeAt(0);
  const targetRange = document.createRange();
  targetRange.selectNodeContents(target);
  return (
    selectionRange.compareBoundaryPoints(Range.START_TO_START, targetRange) === 0 &&
    selectionRange.compareBoundaryPoints(Range.END_TO_END, targetRange) === 0
  );
}

function getTextOffset(root: HTMLElement, node: Node, offset: number): number | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const length = current.textContent?.length ?? 0;
    if (current === node) return cursor + Math.min(offset, length);
    cursor += length;
  }
  return null;
}

function findQuotedLookupRange(text: string, offset: number): { start: number; end: number } | null {
  let quoteStart = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] !== '"') continue;
    if (quoteStart === -1) {
      quoteStart = i;
      continue;
    }

    const value = text.slice(quoteStart + 1, i).replace(/\\"/g, '"');
    if (offset >= quoteStart && offset <= i && (UUID_RE.test(value) || OSDU_ID_RE.test(value))) {
      return { start: quoteStart + 1, end: i };
    }
    quoteStart = -1;
  }
  return null;
}

function createTextRange(root: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) textNodes.push(current as Text);

  const locate = (position: number): [Text, number] | null => {
    let cursor = 0;
    for (const node of textNodes) {
      const length = node.textContent?.length ?? 0;
      if (position <= cursor + length) return [node, position - cursor];
      cursor += length;
    }
    const last = textNodes.at(-1);
    return last ? [last, last.textContent?.length ?? 0] : null;
  };

  const startPoint = locate(start);
  const endPoint = locate(end);
  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(startPoint[0], startPoint[1]);
  range.setEnd(endPoint[0], endPoint[1]);
  return range;
}

function findObjectTypeForUuid(node: JsonValue, uuid: string): string | null {
  if (typeof node !== "object" || node === null) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findObjectTypeForUuid(item, uuid);
      if (found !== null) return found;
    }
    return null;
  }
  const obj = node as Record<string, JsonValue>;

  // If this object directly contains the UUID as a value, check its own $type.
  // Only qualify if $type starts with "resqml" — otherwise keep searching other occurrences.
  const containsUuid = Object.values(obj).some((v) => typeof v === "string" && v === uuid);
  if (containsUuid) {
    const ownType = typeof obj["$type"] === "string" ? (obj["$type"] as string) : undefined;
    if (ownType !== undefined && /^resqml/i.test(ownType)) return ownType;
  }

  // Recurse into child objects regardless, to find other occurrences of the UUID.
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object") {
      const found = findObjectTypeForUuid(val, uuid);
      if (found !== null) return found;
    }
  }
  return null;
}

// ─── RDMS array-data helpers ───────────────────────────────────────────────

const RDMS_ARRAY_TYPES = [
  "resqml20.obj_Grid2dRepresentation",
  "resqml20.obj_PolylineSetRepresentation",
] as const;
type RdmsArrayType = (typeof RDMS_ARRAY_TYPES)[number];

function getRootField<T>(parsed: JsonValue | null, key: string): T | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const v = (parsed as Record<string, JsonValue>)[key];
  return (v as T) ?? null;
}

interface PathTraversalOk { ok: true; value: string }
interface PathTraversalFail {
  ok: false;
  failedKey: string;
  parentPath: string;
  availableKeys: string[] | null;
}
type PathTraversalResult = PathTraversalOk | PathTraversalFail;

function traversePathDebug(root: JsonValue, keys: string[], pathPrefix = ""): PathTraversalResult {
  const fullPath = [pathPrefix, ...keys].filter(Boolean).join(".");
  console.log("[ArrayData] Traversing path:", fullPath);

  let cur: JsonValue = root;
  const traversed: string[] = pathPrefix ? [pathPrefix] : [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const displayPath = [...traversed, key].join(".");

    if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
      console.log(`[ArrayData] ${displayPath} => FAILED (parent is ${Array.isArray(cur) ? "array" : typeof cur})`);
      return { ok: false, failedKey: key, parentPath: traversed.join(".") || "(root)", availableKeys: null };
    }

    const obj = cur as Record<string, JsonValue>;
    const next = obj[key];

    if (next === null || next === undefined) {
      const availableKeys = Object.keys(obj);
      console.log(`[ArrayData] ${displayPath} => FAILED (value is ${next === undefined ? "undefined" : "null"})`);
      if (i === 0 && !pathPrefix) console.log("[ArrayData] Top-level keys:", availableKeys);
      return { ok: false, failedKey: key, parentPath: traversed.join(".") || "(root)", availableKeys };
    }

    if (i === keys.length - 1) {
      if (typeof next === "string") {
        console.log(`[ArrayData] ${displayPath} => OK`);
        return { ok: true, value: next };
      }
      const availableKeys = Object.keys(obj);
      console.log(`[ArrayData] ${displayPath} => FAILED (expected string, got ${Array.isArray(next) ? "array" : typeof next})`);
      return { ok: false, failedKey: key, parentPath: traversed.join(".") || "(root)", availableKeys };
    }

    console.log(`[ArrayData] ${displayPath} => OK`);
    traversed.push(key);
    cur = next;
  }

  return { ok: false, failedKey: "", parentPath: "(root)", availableKeys: null };
}

function formatPathError(result: PathTraversalFail): string {
  const keysStr = result.availableKeys ? `[${result.availableKeys.join(", ")}]` : "N/A";
  return `Path not found: '${result.failedKey}' not found under '${result.parentPath}'. Available keys: ${keysStr}`;
}

function unwrapRecordData(node: JsonValue): JsonValue {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  const data = (node as Record<string, JsonValue>)["data"];
  return data && typeof data === "object" && !Array.isArray(data) ? data : node;
}

// --- Grid2dRepresentation → Grid2dSurface parsing (best-effort, defensive) ---

// Values at/above this magnitude are treated as RESQML/HDF null sentinels
// (commonly 1e30 or similar) rather than real elevations.
const GRID2D_NULL_SENTINEL = 1e29;

/** Walk keys from a node, stepping into the first element of any array. */
function gridReadNode(node: JsonValue | undefined, keys: string[]): JsonValue | undefined {
  let cur: JsonValue | undefined = node ?? undefined;
  for (const key of keys) {
    if (Array.isArray(cur)) cur = cur[0];
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    const next: JsonValue | undefined = (cur as Record<string, JsonValue>)[key];
    if (next === undefined || next === null) return undefined;
    cur = next;
  }
  return cur ?? undefined;
}

function gridReadNumber(node: JsonValue | undefined, keys: string[]): number | undefined {
  const v = gridReadNode(node, keys);
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function gridReadString(node: JsonValue | undefined, keys: string[]): string | undefined {
  const v = gridReadNode(node, keys);
  return typeof v === "string" ? v : undefined;
}

interface Grid2dMeta {
  title: string;
  ni?: number;
  nj?: number;
  origin?: [number, number, number];
  iStep?: [number, number, number];
  jStep?: [number, number, number];
  zIncreasingDownward?: boolean;
}

/** True when a node looks like an embedded LocalDepth3dCrs / LocalTime3dCrs. */
function isLocal3dCrsNode(node: Record<string, JsonValue>): boolean {
  for (const key of ["$type", "Kind", "ContentType", "QualifiedType"]) {
    const value = node[key];
    if (typeof value === "string" && /Local(Depth|Time)3dCrs/i.test(value)) return true;
  }
  return false;
}

/** Read the first `ZIncreasingDownward` boolean anywhere within a node. */
function readZIncreasingDownward(node: JsonValue | undefined, depth = 0): boolean | undefined {
  if (!node || typeof node !== "object" || depth > 12) return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = readZIncreasingDownward(child, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.toLowerCase() === "zincreasingdownward" && typeof value === "boolean") return value;
    const found = readZIncreasingDownward(value, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Find `ZIncreasingDownward` on an embedded LocalDepth3dCrs / LocalTime3dCrs. */
function findCrsZIncreasingDownward(node: JsonValue | undefined, depth = 0): boolean | undefined {
  if (!node || typeof node !== "object" || depth > 12) return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findCrsZIncreasingDownward(child, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = node as Record<string, JsonValue>;
  if (isLocal3dCrsNode(record)) {
    const flag = readZIncreasingDownward(record);
    if (flag !== undefined) return flag;
  }
  for (const value of Object.values(record)) {
    const found = findCrsZIncreasingDownward(value, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Resolve the surface's vertical sense from its CRS. RESQML carries
 * `ZIncreasingDownward` on the referenced LocalDepth3dCrs / LocalTime3dCrs:
 * when true the Z array holds depths (larger = deeper), when false it holds
 * elevations (larger = shallower). Prefer the flag read from an embedded CRS
 * node, falling back to any `ZIncreasingDownward` boolean in the record.
 * Returns undefined when the CRS is only referenced (not embedded).
 */
function findZIncreasingDownward(root: JsonValue | undefined): boolean | undefined {
  return findCrsZIncreasingDownward(root) ?? readZIncreasingDownward(root);
}

/** Resolve grid shape + XY lattice from a Grid2dRepresentation record (no Z). */
function resolveGrid2dMeta(root: JsonValue): Grid2dMeta {
  const title = gridReadString(root, ["Citation", "Title"]) ?? "Grid2dRepresentation";
  const ni = gridReadNumber(root, ["Grid2dPatch", "FastestAxisCount"]);
  const nj = gridReadNumber(root, ["Grid2dPatch", "SlowestAxisCount"]);

  const meta: Grid2dMeta = { title, ni, nj, zIncreasingDownward: findZIncreasingDownward(root) };

  const sg = gridReadNode(root, ["Grid2dPatch", "Geometry", "Points", "SupportingGeometry"]);
  if (sg) {
    const lattice = resolveGrid2dLattice(sg);
    if (lattice) Object.assign(meta, lattice);
  }

  return meta;
}

/**
 * Combine parsed meta + fetched Z array into a Grid2dSurface. Resolves ni/nj
 * from the record, falling back to the array's reported dimensions ([nj, ni]).
 * Returns an error message instead when the shape can't be reconciled.
 */
function buildGrid2dSurface(
  meta: Grid2dMeta,
  rawData: unknown[],
  dimensions: number[] | undefined,
): { surface: Grid2dSurface } | { error: string } {
  // Flatten one level if the array came back as rows.
  const flat: number[] =
    rawData.length > 0 && Array.isArray(rawData[0])
      ? (rawData as unknown[]).flat() as number[]
      : (rawData as number[]);

  let ni = meta.ni;
  let nj = meta.nj;
  if ((ni === undefined || nj === undefined) && dimensions && dimensions.length >= 2) {
    // RDDMS reports [slowest, fastest] = [nj, ni].
    nj = nj ?? dimensions[0];
    ni = ni ?? dimensions[1];
  }
  if (ni === undefined || nj === undefined) {
    return { error: "Could not determine grid dimensions (FastestAxisCount / SlowestAxisCount missing and array dimensions unavailable)." };
  }
  if (ni < 2 || nj < 2) {
    return { error: `Grid too small to render a surface: ${ni}×${nj}.` };
  }
  if (flat.length !== ni * nj) {
    return { error: `Z value count (${flat.length}) does not match grid ${ni}×${nj} = ${ni * nj}.` };
  }

  const z = new Float32Array(flat.length);
  for (let i = 0; i < flat.length; i++) {
    const v = flat[i];
    z[i] = typeof v === "number" && Number.isFinite(v) && Math.abs(v) < GRID2D_NULL_SENTINEL
      ? v
      : NaN;
  }

  return {
    surface: {
      ni,
      nj,
      z,
      origin: meta.origin,
      iStep: meta.iStep,
      jStep: meta.jStep,
      title: meta.title,
      zIncreasingDownward: meta.zIncreasingDownward,
    },
  };
}

function getRdmsArrayType(parsed: JsonValue | null): RdmsArrayType | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const t = (parsed as Record<string, JsonValue>)["$type"];
  if (typeof t === "string" && (RDMS_ARRAY_TYPES as readonly string[]).includes(t)) {
    return t as RdmsArrayType;
  }
  return null;
}

function getRootUuid(parsed: JsonValue | null): string | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const v = (parsed as Record<string, JsonValue>)["uuid"];
  return typeof v === "string" ? v : null;
}

const DDMS_DATASET_RE = /^eml:\/\/(?:\/|[^/]+\/)dataspace\(([^)]*)\)(?:\/([^/(]+)\(([^)]+)\))?/;

interface ParsedDdmsDataset {
  dataspace: string;
  datatype: string | null;
  uuid: string | null;
}

interface ReservoirDdmsTarget {
  dataspace: string;
  datatype: string;
  uuid: string;
}

function reservoirDdmsTargetKey(target: ReservoirDdmsTarget): string {
  return `${target.dataspace}\u0000${target.datatype}\u0000${target.uuid}`;
}

function parseDdmsDataset(value: string): ParsedDdmsDataset | null {
  const match = DDMS_DATASET_RE.exec(value);
  if (!match) return null;
  const dataspace = match[1].replace(/^(['"])(.*)\1$/, "$2").trim();
  if (!dataspace) return null;
  const rawIdentifier = match[3]?.trim() ?? "";
  const uuidField = /(?:^|,)\s*uuid\s*=\s*([^,]+)/i.exec(rawIdentifier);
  const rawUuid = uuidField?.[1] ?? rawIdentifier;
  const uuid = rawUuid.replace(/^(['"])(.*)\1$/, "$2").trim();
  return {
    dataspace,
    datatype: match[2]?.trim() || null,
    uuid: uuid || null,
  };
}

function findReservoirDdmsTargets(node: JsonValue): {
  targets: ReservoirDdmsTarget[];
  unresolvedCount: number;
} {
  const targets: ReservoirDdmsTarget[] = [];
  const seen = new Set<string>();
  let unresolvedCount = 0;

  const visit = (value: JsonValue): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null) return;

    const obj = value as Record<string, JsonValue>;
    const rawDatasets = obj["DDMSDatasets"];
    const datasets = Array.isArray(rawDatasets)
      ? rawDatasets
      : typeof rawDatasets === "string"
        ? [rawDatasets]
        : [];

    for (const rawDataset of datasets) {
      if (typeof rawDataset !== "string" || !rawDataset.trim()) {
        unresolvedCount++;
        continue;
      }
      const dataset = parseDdmsDataset(rawDataset.trim());
      if (!dataset) {
        unresolvedCount++;
        continue;
      }
      const datatype =
        dataset.datatype ??
        (typeof obj["$type"] === "string" ? obj["$type"].trim() : "");
      const uuid =
        dataset.uuid ??
        (typeof obj.uuid === "string" ? obj.uuid.trim() : "");
      if (!datatype || !uuid) {
        unresolvedCount++;
        continue;
      }
      const target = { dataspace: dataset.dataspace, datatype, uuid };
      const key = reservoirDdmsTargetKey(target);
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(target);
    }

    for (const child of Object.values(obj)) {
      if (child && typeof child === "object") visit(child);
    }
  };

  visit(node);
  return { targets, unresolvedCount };
}

function formatReservoirDdmsId(target: ReservoirDdmsTarget): string {
  return `${target.dataspace}/${target.datatype}(${target.uuid})`;
}

interface StorageDdmsDeleteOutcome {
  target: ReservoirDdmsTarget;
  status: "deleted" | "already-absent";
  linkedFromStorage: boolean;
  cascadeFor: string[];
}

interface StorageDdmsCascadeGroup {
  target: ReservoirDdmsTarget;
  referencers: RdmsReferencer[];
}

interface StorageDdmsPlanEntry {
  target: ReservoirDdmsTarget;
  linkedFromStorage: boolean;
  cascadeFor: string[];
  name?: string;
}

interface StorageDdmsCascadePreview {
  groups: StorageDdmsCascadeGroup[];
  checkedCount: number;
  totalCount: number;
  loading: boolean;
  truncated: boolean;
  error: string | null;
}

function buildStorageDdmsPlanEntries(
  linkedTargets: ReservoirDdmsTarget[],
  groups: StorageDdmsCascadeGroup[],
): StorageDdmsPlanEntry[] {
  const entries = new Map<
    string,
    { target: ReservoirDdmsTarget; linkedFromStorage: boolean; cascadeFor: Set<string>; name?: string }
  >();
  const ensureEntry = (target: ReservoirDdmsTarget) => {
    const key = reservoirDdmsTargetKey(target);
    let entry = entries.get(key);
    if (!entry) {
      entry = { target, linkedFromStorage: false, cascadeFor: new Set<string>() };
      entries.set(key, entry);
    }
    return entry;
  };

  for (const target of linkedTargets) {
    ensureEntry(target).linkedFromStorage = true;
  }
  for (const group of groups) {
    const rootKey = reservoirDdmsTargetKey(group.target);
    const rootId = formatReservoirDdmsId(group.target);
    for (const referencer of group.referencers) {
      const target = {
        dataspace: group.target.dataspace,
        datatype: referencer.datatype,
        uuid: referencer.uuid,
      };
      if (reservoirDdmsTargetKey(target) === rootKey) continue;
      const entry = ensureEntry(target);
      entry.cascadeFor.add(rootId);
      if (!entry.name && referencer.name) entry.name = referencer.name;
    }
  }

  return [...entries.values()].map((entry) => ({
    target: entry.target,
    linkedFromStorage: entry.linkedFromStorage,
    cascadeFor: [...entry.cascadeFor],
    name: entry.name,
  }));
}

function describeStorageDdmsPlanEntry(entry: StorageDdmsPlanEntry): string {
  const reasons = [
    ...(entry.linkedFromStorage ? ["linked from Storage"] : []),
    ...(entry.cascadeFor.length > 0 ? [`cascade member for ${entry.cascadeFor.join(", ")}`] : []),
  ];
  return `${entry.name ? `${entry.name} — ` : ""}${formatReservoirDdmsId(entry.target)}${reasons.length ? ` [${reasons.join("; ")}]` : ""}`;
}

function formatStorageDdmsPlan(
  recordId: string | null,
  entries: StorageDdmsPlanEntry[],
  preview: StorageDdmsCascadePreview,
  unresolvedCount: number,
): string {
  const lines = [
    `Storage Service record: ${recordId ?? "record ID unavailable"}`,
    `Reservoir DDMS records found for deletion before Storage: ${entries.length}`,
  ];
  if (preview.loading) {
    lines.push(`Reference scan in progress: checked ${preview.checkedCount} of ${preview.totalCount} linked records.`);
  }
  if (preview.error) lines.push(`WARNING: the reference scan is incomplete: ${preview.error}`);
  if (preview.truncated) lines.push("WARNING: Reservoir DDMS returned a truncated reference list.");
  if (unresolvedCount > 0) {
    lines.push(`WARNING: ${unresolvedCount} DDMS reference(s) could not be identified and are not in this list.`);
  }
  if (entries.length === 0) {
    lines.push("Reservoir DDMS records: none identified");
  } else {
    lines.push("Reservoir DDMS records:");
    for (const entry of entries) lines.push(`- ${describeStorageDdmsPlanEntry(entry)}`);
  }
  return lines.join("\n");
}

function formatStorageDdmsOutcome(outcome: StorageDdmsDeleteOutcome): string {
  const status = outcome.status === "deleted" ? "Deleted" : "Already absent";
  const reasons = [
    ...(outcome.linkedFromStorage ? ["linked from Storage"] : []),
    ...(outcome.cascadeFor.length > 0 ? [`cascade member for ${outcome.cascadeFor.join(", ")}`] : []),
  ];
  return `${status}: ${formatReservoirDdmsId(outcome.target)}${reasons.length ? ` [${reasons.join("; ")}]` : ""}`;
}

interface StorageDeleteCompletion {
  mode: "soft" | "purge";
  recordId: string;
  ddmsOutcomes: StorageDdmsDeleteOutcome[];
}

function formatStorageDeleteSummary(completion: StorageDeleteCompletion): string {
  const lines = [
    `Storage record ${completion.mode === "soft" ? "soft-deleted" : "permanently purged"}: ${completion.recordId}`,
  ];
  if (completion.ddmsOutcomes.length === 0) {
    lines.push("Reservoir DDMS records deleted: none");
  } else {
    lines.push("Reservoir DDMS records:");
    for (const outcome of completion.ddmsOutcomes) {
      lines.push(formatStorageDdmsOutcome(outcome));
    }
  }
  return lines.join("\n");
}

function formatPartialStorageDeleteSummary(
  recordId: string,
  outcomes: StorageDdmsDeleteOutcome[],
): string {
  const lines = [`Storage record deletion did not complete successfully: ${recordId}`];
  if (outcomes.length === 0) {
    lines.push("No Reservoir DDMS records were deleted.");
  } else {
    lines.push("Reservoir DDMS results:");
    for (const outcome of outcomes) {
      lines.push(formatStorageDdmsOutcome(outcome));
    }
  }
  return lines.join("\n");
}

function findFirstStringField(node: JsonValue, key: string): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstStringField(item, key);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object" || node === null) return null;

  const obj = node as Record<string, JsonValue>;
  if (typeof obj[key] === "string" && obj[key].trim()) return obj[key].trim();
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findFirstStringField(value, key);
      if (found) return found;
    }
  }
  return null;
}

interface ArrayDataResult {
  label: string;
  dimensions?: number[];
  data?: unknown[];
  error?: string;
}

const MAX_RENDERED_ROWS = 500;

// Above this many referencing records, a cascade delete requires an explicit
// acknowledgement checkbox before it can be run — a safety gate on large blast radii.
const BLAST_RADIUS_THRESHOLD = 10;

function formatNumber(n: number): string {
  if (!isFinite(n)) return String(n);
  return Math.trunc(n).toLocaleString();
}

function CopyErrorButton({ error }: { error: string }) {
  const [copied, setCopied] = useState(false);
  const copiedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
  }, []);

  const handleCopy = useCallback(() => {
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) return;
    void writeText.call(navigator.clipboard, error).then(() => {
      setCopied(true);
      if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
      copiedResetRef.current = setTimeout(() => {
        setCopied(false);
        copiedResetRef.current = null;
      }, 1500);
    }).catch(() => {
      setCopied(false);
    });
  }, [error]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
           className="h-6 w-6 shrink-0 text-error-text hover:bg-error-border/15 hover:text-error-text"
          onClick={handleCopy}
          aria-label={copied ? "Error copied" : "Copy error"}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied!" : "Copy error"}</TooltipContent>
    </Tooltip>
  );
}

function CopyTextButton({
  text,
  label,
  testId,
}: {
  text: string;
  label: string;
  testId: string;
}) {
  const [copied, setCopied] = useState(false);
  const copiedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
  }, []);

  const handleCopy = useCallback(() => {
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) return;
    void writeText.call(navigator.clipboard, text).then(() => {
      setCopied(true);
      if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
      copiedResetRef.current = setTimeout(() => {
        setCopied(false);
        copiedResetRef.current = null;
      }, 1500);
    }).catch(() => {
      setCopied(false);
    });
  }, [text]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 shrink-0 gap-1.5 px-2 text-xs"
      onClick={handleCopy}
      aria-label={copied ? `${label} copied` : label}
      data-testid={testId}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function ArrayDataTable({ result }: { result: ArrayDataResult }) {
  const { startActivity } = useActivityProgress();
  const [flashCell, setFlashCell] = useState<string | null>(null);
  const [csvDownloading, setCsvDownloading] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const [scrollMetrics, setScrollMetrics] = useState({ contentWidth: 0, viewportWidth: 0 });

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  }, []);

  const shortPath = result.label.split("/").filter(Boolean).slice(-2).join("/");

  if (result.error) {
    return (
      <div className="flex flex-col gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="text-[11px] font-mono text-cyan-500 truncate px-1 cursor-default">…/{shortPath}</div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs font-mono text-[10px] break-all">{result.label}</TooltipContent>
        </Tooltip>
        <div className="flex items-start gap-2 rounded-md border border-error-border/60 bg-error-surface px-3 py-2 text-xs text-error-text">
          <span className="min-w-0 flex-1 break-words">{result.error}</span>
          <CopyErrorButton error={result.error} />
        </div>
      </div>
    );
  }

  const data = result.data ?? [];
  const dims = result.dimensions ?? [data.length];
  const is2D = dims.length >= 2;
  const rowCount = dims[0] ?? 0;
  const colCount = is2D ? (dims[1] ?? 1) : 1;
  const visibleRows = Math.min(rowCount, MAX_RENDERED_ROWS);
  const truncated = rowCount > MAX_RENDERED_ROWS;

  useLayoutEffect(() => {
    const updateScrollMetrics = () => {
      const container = tableScrollRef.current;
      if (!container) return;
      setScrollMetrics({
        contentWidth: container.scrollWidth,
        viewportWidth: container.clientWidth,
      });
    };

    updateScrollMetrics();
    const resizeObserver = new ResizeObserver(updateScrollMetrics);
    if (tableScrollRef.current) resizeObserver.observe(tableScrollRef.current);
    return () => resizeObserver.disconnect();
  }, [colCount, rowCount]);

  const hasHorizontalOverflow = scrollMetrics.contentWidth > scrollMetrics.viewportWidth + 1;

  function getCell(row: number, col: number): unknown {
    if (Array.isArray(data[row])) return (data[row] as unknown[])[col];
    if (is2D) return data[row * colCount + col];
    return data[row];
  }

  function renderCellValue(val: unknown) {
    if (val === null || val === undefined) return <span className="text-muted-foreground/40">—</span>;
    if (typeof val === "number") return formatNumber(val);
    if (typeof val === "object") return <span className="font-mono text-muted-foreground/80">{JSON.stringify(val)}</span>;
    return String(val);
  }

  function copyCell(val: unknown, key: string) {
    const text = val === null || val === undefined ? "" : String(val);
    void navigator.clipboard.writeText(text);
    setFlashCell(key);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      setFlashCell(prev => prev === key ? null : prev);
      flashTimerRef.current = null;
    }, 700);
  }

  async function downloadCsv() {
    if (csvDownloading) return;
    const finishActivity = startActivity("Preparing CSV");
    const header = is2D
      ? ["row", ...Array.from({ length: colCount }, (_, i) => String(i))].join(",")
      : "row,value";
    setCsvDownloading(true);
    try {
      // Keep each synchronous slice bounded so large exports yield to input,
      // paint, and other browser work between chunks. Blob accepts parts, so
      // the completed CSV does not need another giant string concatenation.
      const chunkSize = 1_000;
      const csvParts: BlobPart[] = [header];
      for (let start = 0; start < rowCount; start += chunkSize) {
        const end = Math.min(rowCount, start + chunkSize);
        const chunkRows = Array.from({ length: end - start }, (_, offset) => {
          const ri = start + offset;
          const cells = is2D
            ? Array.from({ length: colCount }, (_, ci) => {
                const v = getCell(ri, ci);
                const s = v === null || v === undefined ? "" : String(v);
                return s.includes(",") ? `"${s}"` : s;
              })
            : [String(getCell(ri, 0) ?? "")];
          return [ri, ...cells].join(",");
        });
        csvParts.push(`\n${chunkRows.join("\n")}`);
        if (end < rowCount) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }

      const blob = new Blob(csvParts, { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${shortPath.replace(/\//g, "_")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setCsvDownloading(false);
      finishActivity();
    }
  }

  const statsLabel = `${rowCount.toLocaleString()} row${rowCount !== 1 ? "s" : ""}${is2D ? ` × ${colCount.toLocaleString()} col${colCount !== 1 ? "s" : ""}` : ""} · [${dims.join(", ")}]`;

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Header: path + stats + download */}
      <div className="flex items-center justify-between gap-3 px-1 min-w-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="text-[11px] font-mono text-cyan-500 truncate cursor-default min-w-0">…/{shortPath}</div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm font-mono text-[10px] break-all">{result.label}</TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{statsLabel}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => void downloadCsv()}
                disabled={csvDownloading}
                aria-label={csvDownloading ? "Preparing CSV" : "Download CSV"}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download CSV ({rowCount.toLocaleString()} rows)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border/50 flex flex-col flex-1 min-h-0 overflow-hidden">
        {hasHorizontalOverflow && (
          <div
            ref={scrollbarRef}
            className="shrink-0 h-3 overflow-x-auto overflow-y-hidden border-b border-border/40 bg-muted/20"
            onScroll={(event) => {
              if (tableScrollRef.current) {
                tableScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
              }
            }}
            aria-label="Horizontal array table scrollbar"
          >
            <div style={{ width: scrollMetrics.contentWidth, height: 1 }} />
          </div>
        )}
        <div
          ref={tableScrollRef}
          className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto"
          aria-label="Array data table viewport"
          onScroll={(event) => {
            if (scrollbarRef.current) {
              scrollbarRef.current.scrollLeft = event.currentTarget.scrollLeft;
            }
          }}
        >
          <table
            aria-label="Array data table"
            className="w-max caption-bottom text-sm min-w-max border-collapse"
          >
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50 leading-none">
                <TableHead className="sticky top-0 left-0 z-30 bg-muted/50 border-r border-border/40 text-[11px] font-semibold text-muted-foreground py-0 px-0 w-8 text-center select-none">
                  #
                </TableHead>
                {is2D
                  ? Array.from({ length: colCount }, (_, ci) => (
                      <TableHead key={ci} className="sticky top-0 z-20 bg-muted/50 text-[11px] font-semibold text-muted-foreground py-0 px-0 text-right tabular-nums whitespace-nowrap min-w-[40px]">
                        {ci}
                      </TableHead>
                    ))
                  : <TableHead className="sticky top-0 z-20 bg-muted/50 text-[11px] font-semibold text-muted-foreground py-0 px-0">value</TableHead>
                }
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: visibleRows }, (_, ri) => {
                const isOdd = ri % 2 === 1;
                const rowBg = isOdd ? "hsl(var(--muted) / 0.25)" : "transparent";
                return (
                  <TableRow
                    key={ri}
                    data-array-row-index={ri}
                    style={{ background: rowBg }}
                    className="hover:!bg-accent/40"
                  >
                    <TableCell
                      data-array-row-label={ri}
                      className="sticky left-0 z-10 min-w-8 w-8 border-r border-border/30 text-[11px] tabular-nums text-muted-foreground text-center py-0 px-0 select-none leading-none"
                      style={{ background: isOdd ? "hsl(var(--muted))" : "hsl(var(--background))" }}
                    >
                      {ri}
                    </TableCell>
                    {is2D
                      ? Array.from({ length: colCount }, (_, ci) => {
                          const val = getCell(ri, ci);
                          const key = `${ri}-${ci}`;
                          return (
                            <TableCell
                              key={ci}
                              onClick={() => copyCell(val, key)}
                              title="Click to copy"
                              className={cn(
                                "text-xs py-0 px-0 tabular-nums text-right whitespace-nowrap cursor-pointer transition-colors duration-150 leading-none",
                                flashCell === key ? "!bg-yellow-400/40" : ""
                              )}
                            >
                              {renderCellValue(val)}
                            </TableCell>
                          );
                        })
                      : (() => {
                          const val = getCell(ri, 0);
                          const key = `${ri}-0`;
                          return (
                            <TableCell
                              onClick={() => copyCell(val, key)}
                              title="Click to copy"
                              className={cn(
                                "text-xs py-0 px-0 tabular-nums cursor-pointer transition-colors duration-150 leading-none",
                                flashCell === key ? "!bg-yellow-400/40" : ""
                              )}
                            >
                              {renderCellValue(val)}
                            </TableCell>
                          );
                        })()
                    }
                  </TableRow>
                );
              })}
            </TableBody>
          </table>
        </div>
        <div className="px-3 py-1.5 border-t border-border/40 bg-muted/20 text-[11px] text-muted-foreground flex items-center justify-between gap-2">
          {truncated
            ? <span className="text-amber-500">Showing first {MAX_RENDERED_ROWS.toLocaleString()} of {rowCount.toLocaleString()} rows — download CSV for all data</span>
            : <span>Click any value cell to copy · {rowCount.toLocaleString()} row{rowCount !== 1 ? "s" : ""} total</span>
          }
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────

export function JsonViewerContent({
  json,
  className,
  storageKey,
  _isFullscreen = false,
  onMaximize,
  onPopOut,
  sharedTreeState,
  sharedViewerState,
  hideStorageLookup,
  hideSearchLookup,
  hideDdmsLookup,
  hideWdmsLookup,
  rdmsContext,
  searchRecordId,
  storageRecordId,
  lookupResult,
  onLookupResult,
  onResponseTypeChange,
  onRecordDeleted,
  openStorageDeleteRequestId,
  onStorageDeleteRequestHandled,
  openRdmsDeleteRequestId,
  onRdmsDeleteRequestHandled,
}: JsonViewerToolbarProps & {
  onMaximize?: () => void;
  onPopOut?: () => void;
  sharedTreeState?: TreeCollapsedState;
  sharedViewerState?: SharedViewerState;
  onResponseTypeChange?: (type: ResponseType) => void;
  openStorageDeleteRequestId?: string | null;
  onStorageDeleteRequestHandled?: () => void;
}) {
  const { startActivity } = useActivityProgress();
  const containerRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeRawMatchRef = useRef<HTMLElement>(null);
  const activeTreeMatchRef = useRef<HTMLElement | null>(null);

  const [localViewMode, setLocalViewMode] = useState<ViewMode>("tree");
  const [copied, setCopied] = useState(false);
  const [localSearchOpen, setLocalSearchOpen] = useState(false);
  const [localQuery, setLocalQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [lineWrap, setLineWrap] = useState(true);
  const [fontSize, setFontSize] = useState(12);
  const [badgeRendered, setBadgeRendered] = useState(false);
  const [badgeExiting, setBadgeExiting] = useState(false);
  const badgeExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedText, setSelectedText] = useState("");
  const [allSelected, setAllSelected] = useState(false);
  const [lookupLoading, setLookupLoading] = useState<"search" | "storage" | "ddms" | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const errorDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [overlayJson, setOverlayJson] = useState<string | null>(null);
  const [overlayLabel, setOverlayLabel] = useState<string | null>(null);
  const [resolvedRdmsContext, setResolvedRdmsContext] = useState<JsonViewerToolbarProps["rdmsContext"] | null>(null);
  const activeRdmsContext = lookupResult?.rdmsContext ?? resolvedRdmsContext ?? rdmsContext;
  const originalResponseType: ResponseType | null = storageRecordId
    ? "search"
    : searchRecordId
      ? "storage"
      : null;

  type WdmsResult = {
    urn: string;
    status: "found" | "error";
    columns?: string[];
    dataRows?: unknown[][];
    error?: string;
  };
  const [wdmsOpen, setWdmsOpen] = useState(false);
  const [wdmsResults, setWdmsResults] = useState<WdmsResult[]>([]);
  const [wdmsLoading, setWdmsLoading] = useState(false);
  const [wdmsError, setWdmsError] = useState<string | null>(null);

  const [arrayOpen, setArrayOpen] = useState(false);
  const [arrayLoading, setArrayLoading] = useState(false);
  const [arrayError, setArrayError] = useState<string | null>(null);
  const [arrayResults, setArrayResults] = useState<ArrayDataResult[]>([]);
  const [grid2dOpen, setGrid2dOpen] = useState(false);
  const [grid2dLoading, setGrid2dLoading] = useState(false);
  const [grid2dError, setGrid2dError] = useState<string | null>(null);
  const [grid2dSurface, setGrid2dSurface] = useState<Grid2dSurface | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [editParseError, setEditParseError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editSaveStep, setEditSaveStep] = useState<string | null>(null);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Cascade-delete discovery state. `referencers` is null until the check
  // finishes: null → still checking / not yet checked, [] → deletable on its own,
  // non-empty → other records must be deleted together (blast radius preview).
  const [checkingRefs, setCheckingRefs] = useState(false);
  const [referencers, setReferencers] = useState<RdmsReferencer[] | null>(null);
  const [referencersTruncated, setReferencersTruncated] = useState(false);
  const [blastAck, setBlastAck] = useState(false);
  const [storageDeleteConfirmOpen, setStorageDeleteConfirmOpen] = useState(false);
  const [storageDeleting, setStorageDeleting] = useState<"soft" | "purge" | null>(null);
  const [storageDeleteError, setStorageDeleteError] = useState<string | null>(null);
  const [deleteLinkedDdms, setDeleteLinkedDdms] = useState(false);
  const [storageDeleteStep, setStorageDeleteStep] = useState<string | null>(null);
  const [storageDdmsDeleteOutcomes, setStorageDdmsDeleteOutcomes] = useState<StorageDdmsDeleteOutcome[]>([]);
  const [storageDdmsCascadePreview, setStorageDdmsCascadePreview] = useState<StorageDdmsCascadePreview>({
    groups: [],
    checkedCount: 0,
    totalCount: 0,
    loading: false,
    truncated: false,
    error: null,
  });
  const [storageDdmsBlastAck, setStorageDdmsBlastAck] = useState(false);
  const storageDdmsPreviewRunRef = useRef(0);
  const handledStorageDeleteRequestRef = useRef<string | null>(null);
  const handledRdmsDeleteRequestRef = useRef<string | null>(null);
  const [storageDeleteCompletion, setStorageDeleteCompletion] = useState<StorageDeleteCompletion | null>(null);
  const lookupAbortControllerRef = useRef<AbortController | null>(null);
  const wdmsAbortControllerRef = useRef<AbortController | null>(null);
  const arrayAbortControllerRef = useRef<AbortController | null>(null);
  const grid2dAbortControllerRef = useRef<AbortController | null>(null);

  const MIN_FONT_SIZE = 10;
  const MAX_FONT_SIZE = 20;

  const viewMode = sharedViewerState ? sharedViewerState.viewMode : localViewMode;
  const searchOpen = sharedViewerState ? sharedViewerState.searchOpen : localSearchOpen;
  const query = sharedViewerState ? sharedViewerState.query : localQuery;

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      if (sharedViewerState) {
        sharedViewerState.onViewModeChange(mode);
      } else {
        setLocalViewMode(mode);
      }
    },
    [sharedViewerState],
  );

  const setSearchOpen = useCallback(
    (open: boolean) => {
      if (sharedViewerState) {
        sharedViewerState.onSearchOpenChange(open);
      } else {
        setLocalSearchOpen(open);
      }
    },
    [sharedViewerState],
  );

  const setQuery = useCallback(
    (q: string) => {
      if (sharedViewerState) {
        sharedViewerState.onQueryChange(q);
      } else {
        setLocalQuery(q);
      }
    },
    [sharedViewerState],
  );

  const displayJson = lookupResult?.json ?? overlayJson ?? json;

  const parsedJson: JsonValue | null = useMemo(() => {
    try {
      return JSON.parse(displayJson) as JsonValue;
    } catch {
      return null;
    }
  }, [displayJson]);

  const showTree = viewMode === "tree" && parsedJson !== null;
  const displayedRecordId = useMemo(() => {
    const rootId = getRootField<string>(parsedJson, "id")?.trim();
    return rootId || storageRecordId?.trim() || searchRecordId?.trim() || null;
  }, [parsedJson, storageRecordId, searchRecordId]);
  const storageDdmsScan = useMemo(
    () => parsedJson ? findReservoirDdmsTargets(parsedJson) : { targets: [], unresolvedCount: 0 },
    [parsedJson],
  );
  const storageDdmsPlanEntries = useMemo(
    () => buildStorageDdmsPlanEntries(storageDdmsScan.targets, storageDdmsCascadePreview.groups),
    [storageDdmsScan.targets, storageDdmsCascadePreview.groups],
  );
  const storageDdmsPreviewComplete =
    !storageDdmsCascadePreview.loading &&
    !storageDdmsCascadePreview.error &&
    !storageDdmsCascadePreview.truncated &&
    storageDdmsCascadePreview.checkedCount === storageDdmsCascadePreview.totalCount &&
    storageDdmsScan.unresolvedCount === 0;
  const ddmsTarget = storageDdmsScan.targets[0] ?? null;

  // --- Tree mode matches ---
  const treeMatches: TreeMatch[] = useMemo(() => {
    if (!showTree || !query || !parsedJson) return [];
    const raw = buildTreeMatches(parsedJson, "root", query);
    return raw.map((m, i) => ({ ...m, globalIndex: i }));
  }, [showTree, query, parsedJson]);

  // --- Raw mode matches ---
  const rawMatches: RawMatch[] = useMemo(() => {
    if (showTree || !query) return [];
    const lower = displayJson.toLowerCase();
    const q = query.toLowerCase();
    const found: RawMatch[] = [];
    let idx = 0;
    while (idx < lower.length && found.length < MAX_SEARCH_MATCHES) {
      const pos = lower.indexOf(q, idx);
      if (pos === -1) break;
      found.push({ start: pos, end: pos + q.length });
      idx = pos + q.length;
    }
    return found;
  }, [showTree, query, displayJson]);

  const totalMatches = showTree ? treeMatches.length : rawMatches.length;

  // Reset active index when matches change
  useEffect(() => {
    setActiveIndex(0);
  }, [treeMatches, rawMatches]);

  // Animate badge in/out when match count crosses zero
  const hasMatches = totalMatches > 0 && !!query;
  useEffect(() => {
    if (hasMatches) {
      if (badgeExitTimerRef.current) {
        clearTimeout(badgeExitTimerRef.current);
        badgeExitTimerRef.current = null;
      }
      setBadgeExiting(false);
      setBadgeRendered(true);
    } else if (badgeRendered) {
      setBadgeExiting(true);
      badgeExitTimerRef.current = setTimeout(() => {
        setBadgeRendered(false);
        setBadgeExiting(false);
        badgeExitTimerRef.current = null;
      }, 160);
    }
    return () => {
      if (badgeExitTimerRef.current) {
        clearTimeout(badgeExitTimerRef.current);
      }
    };
  }, [hasMatches]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectAll = useCallback(() => {
    const target = showTree
      ? treeRef.current?.querySelector<HTMLElement>("[data-json-content]")
      : preRef.current;
    if (!target) return;
    const sel = window.getSelection();
    if (selectionCoversTarget(sel, target)) {
      sel?.removeAllRanges();
      setAllSelected(false);
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(target);
    sel?.removeAllRanges();
    sel?.addRange(range);
    setAllSelected(true);
  }, [showTree]);

  const handleCopy = useCallback(() => {
    const sel = window.getSelection();
    const selectedText = sel && sel.toString().length > 0 ? sel.toString() : null;
    void navigator.clipboard.writeText(selectedText ?? displayJson).then(() => {
      setCopied(true);
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyResetTimerRef.current = null;
      }, 2000);
    });
  }, [displayJson]);

  const toggleSearch = useCallback(() => {
    setSearchOpen(!searchOpen);
  }, [searchOpen, setSearchOpen]);

  const closeAndClearSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, [setSearchOpen, setQuery]);

  useEffect(() => {
    if (!searchOpen) return;
    if (searchFocusTimerRef.current) clearTimeout(searchFocusTimerRef.current);
    searchFocusTimerRef.current = setTimeout(() => {
      searchInputRef.current?.focus();
      searchFocusTimerRef.current = null;
    }, 0);
    return () => {
      if (searchFocusTimerRef.current) {
        clearTimeout(searchFocusTimerRef.current);
        searchFocusTimerRef.current = null;
      }
    };
  }, [searchOpen]);

  // Scroll active raw match into view
  useEffect(() => {
    if (!showTree && activeRawMatchRef.current) {
      activeRawMatchRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, rawMatches, showTree]);

  // Scroll active tree match into view
  useEffect(() => {
    if (showTree && activeTreeMatchRef.current) {
      activeTreeMatchRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, treeMatches, showTree]);

  const goNext = useCallback(() => {
    if (totalMatches === 0) return;
    setActiveIndex((i) => (i + 1) % totalMatches);
  }, [totalMatches]);

  const goPrev = useCallback(() => {
    if (totalMatches === 0) return;
    setActiveIndex((i) => (i - 1 + totalMatches) % totalMatches);
  }, [totalMatches]);

  const handleSearchKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        toggleSearch();
      } else if (e.key === "Enter") {
        if (e.shiftKey) {
          goPrev();
        } else {
          goNext();
        }
        e.preventDefault();
      }
    },
    [toggleSearch, goNext, goPrev],
  );

  const handleActiveTreeRef = useCallback((el: HTMLElement | null) => {
    activeTreeMatchRef.current = el;
  }, [viewMode]);

  // Auto-select the full OSDU record ID when clicking anywhere inside its quoted value.
  const handleContainerClick = useCallback(() => {
    if (showTree) return;
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const target = preRef.current;
    if (!target) return;
    const offset = getTextOffset(target, range.startContainer, range.startOffset);
    if (offset === null) return;
    const quotedRange = findQuotedLookupRange(target.textContent ?? "", offset);
    if (!quotedRange) return;
    const newRange = createTextRange(target, quotedRange.start, quotedRange.end);
    if (!newRange) return;
    sel.removeAllRanges();
    sel.addRange(newRange);
  }, [showTree]);

  // Track text selection within the viewer and whether the JSON content is fully selected.
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      const target = showTree
        ? treeRef.current?.querySelector<HTMLElement>("[data-json-content]") ?? null
        : preRef.current;
      setAllSelected(selectionCoversTarget(sel, target));

      if (!_isFullscreen) return;
      const text = sel?.toString().trim() ?? "";
      if (text && containerRef.current && sel?.rangeCount) {
        const range = sel.getRangeAt(0);
        if (containerRef.current.contains(range.commonAncestorContainer)) {
          setSelectedText(text);
          return;
        }
      }
      setSelectedText("");
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [_isFullscreen, showTree]);

  // Auto-dismiss lookup error after 4 seconds
  useEffect(() => {
    if (!lookupError) return;
    if (errorDismissTimerRef.current) clearTimeout(errorDismissTimerRef.current);
    errorDismissTimerRef.current = setTimeout(() => setLookupError(null), 4000);
    return () => {
      if (errorDismissTimerRef.current) clearTimeout(errorDismissTimerRef.current);
    };
  }, [lookupError]);

  useEffect(() => () => {
    if (badgeExitTimerRef.current) clearTimeout(badgeExitTimerRef.current);
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    if (searchFocusTimerRef.current) clearTimeout(searchFocusTimerRef.current);
    if (errorDismissTimerRef.current) clearTimeout(errorDismissTimerRef.current);
    lookupAbortControllerRef.current?.abort();
    wdmsAbortControllerRef.current?.abort();
    arrayAbortControllerRef.current?.abort();
    grid2dAbortControllerRef.current?.abort();
  }, []);

  const openRecordInPopout = useCallback((recordJson: string, label: string) => {
    const dataKey = `osdu-json-popout-${Date.now()}`;
    localStorage.setItem(dataKey, recordJson);
    trackEvent("json_popout_opened", {
      source: "lookup",
      view_mode: viewMode,
    });
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const params = new URLSearchParams({ data: dataKey, label });
    window.open(`${base}/json-popout?${params.toString()}`, "_blank");
  }, []);

  const handleStorageLookup = useCallback(async () => {
    const selectedStorageId = extractFirstOsduId(selectedText);
    const lookupId = selectedStorageId || displayedRecordId || selectedText.trim();
    if (!lookupId || lookupLoading) return;
    setLookupLoading("storage");
    setLookupError(null);
    const controller = new AbortController();
    lookupAbortControllerRef.current = controller;
    try {
      const res = await fetch(`/api/osdu/records/${encodeURIComponent(lookupId)}`, { signal: controller.signal });
      if (res.status === 404) { setLookupError("Record not found"); return; }
      if (!res.ok) { setLookupError("Failed to fetch record"); return; }
      const data: unknown = await res.json();
      setOverlayJson(JSON.stringify(data, null, 2));
      setOverlayLabel(lookupId);
      onResponseTypeChange?.("storage");
    } catch (error) {
      if (isAbortError(error)) return;
      setLookupError("Failed to fetch record");
    } finally {
      if (lookupAbortControllerRef.current === controller) lookupAbortControllerRef.current = null;
      setLookupLoading(null);
    }
  }, [selectedText, displayedRecordId, lookupLoading, onResponseTypeChange]);

  const handleSearchLookup = useCallback(async () => {
    const selectedSearchId = extractFirstOsduId(selectedText);
    const lookupId = selectedSearchId || displayedRecordId || selectedText.trim();
    if (!lookupId || lookupLoading) return;
    setLookupLoading("search");
    setLookupError(null);
    const controller = new AbortController();
    lookupAbortControllerRef.current = controller;
    try {
      const res = await fetch("/api/osdu/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "*:*:*:*", query: `id:"${lookupId}"`, limit: 1 }),
        signal: controller.signal,
      });
      if (!res.ok) { setLookupError("Search failed"); return; }
      const data = await res.json() as { results: unknown[]; totalCount: number };
      if (data.totalCount === 0 || data.results.length === 0) { setLookupError("No results found"); return; }
      setOverlayJson(JSON.stringify(data.results[0], null, 2));
      setOverlayLabel(lookupId);
      onResponseTypeChange?.("search");
    } catch (error) {
      if (isAbortError(error)) return;
      setLookupError("Search failed");
    } finally {
      if (lookupAbortControllerRef.current === controller) lookupAbortControllerRef.current = null;
      setLookupLoading(null);
    }
  }, [selectedText, displayedRecordId, lookupLoading, onResponseTypeChange]);

  const handleDdmsLookup = useCallback(async () => {
    if (!ddmsTarget || lookupLoading) return;
    if (!ddmsTarget.datatype || !ddmsTarget.uuid) {
      setLookupError("The record is missing the Reservoir DDMS type or UUID");
      return;
    }
    setLookupLoading("ddms");
    setLookupError(null);
    const controller = new AbortController();
    lookupAbortControllerRef.current = controller;
    try {
      const url = `/api/osdu/rdms/dataspaces/${encodeURIComponent(ddmsTarget.dataspace)}/resources/${encodeURIComponent(ddmsTarget.datatype)}/${encodeURIComponent(ddmsTarget.uuid)}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setLookupError(err.error ?? "Failed to fetch Reservoir DDMS record");
        return;
      }
      const result: JsonViewerLookupResult = {
        responseType: "ddms",
        json: JSON.stringify(await res.json(), null, 2),
        label: ddmsTarget.uuid,
        storageKey: `rdms:${ddmsTarget.dataspace}:${ddmsTarget.datatype}:${ddmsTarget.uuid}`,
        rdmsContext: {
          dataspace: ddmsTarget.dataspace,
          datatype: ddmsTarget.datatype,
          uuid: ddmsTarget.uuid,
        },
      };
      if (lookupResult !== undefined) {
        onLookupResult?.(result);
      } else {
        setOverlayJson(result.json);
        setOverlayLabel(result.label);
        setResolvedRdmsContext(result.rdmsContext ?? null);
      }
      onResponseTypeChange?.("ddms");
    } catch (error) {
      if (isAbortError(error)) return;
      setLookupError("Failed to fetch Reservoir DDMS record");
    } finally {
      if (lookupAbortControllerRef.current === controller) lookupAbortControllerRef.current = null;
      setLookupLoading(null);
    }
  }, [ddmsTarget, lookupLoading, lookupResult, onLookupResult, onResponseTypeChange]);

  const handleBackToOriginal = useCallback(() => {
    if (lookupResult) {
      onLookupResult?.(null);
    }
    if (overlayJson) {
      setOverlayJson(null);
      setOverlayLabel(null);
      setResolvedRdmsContext(null);
    }
    if (originalResponseType) onResponseTypeChange?.(originalResponseType);
  }, [lookupResult, onLookupResult, originalResponseType, onResponseTypeChange, overlayJson]);

  // Extract OSDU record IDs from selectedText (handles single ID or text containing multiple IDs)
  const selectedUrns = useMemo(() => {
    if (!selectedText) return [];
    const matches = [...selectedText.matchAll(OSDU_ID_EXTRACT_RE)];
    return [...new Set(matches.map((m) => m[0].replace(/:+$/, "")))];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedText]);

  // WDMS-eligible IDs: only those whose ID string encodes a supported kind
  const WDMS_SUPPORTED_KINDS = ["work-product-component--WellLog", "work-product-component--WellboreTrajectory"];
  const wdmsUrns = useMemo(
    () => selectedUrns.filter((id) => WDMS_SUPPORTED_KINDS.some((k) => id.includes(k))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedUrns],
  );

  const handleWdmsSearch = useCallback(async () => {
    if (wdmsUrns.length === 0 || wdmsLoading) return;
    setWdmsLoading(true);
    setWdmsError(null);
    setWdmsResults([]);
    const controller = new AbortController();
    wdmsAbortControllerRef.current = controller;
    try {
      const res = await fetch("/api/osdu/wdms/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urns: wdmsUrns }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setWdmsError(err.error ?? "WDMS request failed");
        setWdmsOpen(true);
        return;
      }
      const json = await res.json() as { results: Array<{ urn: string; status: "found" | "error"; data?: Record<string, unknown>; error?: string }> };
      const parsed: WdmsResult[] = json.results.map((row) => {
        if (row.status === "found" && row.data) {
          const columns = Array.isArray(row.data.columns)
            ? (row.data.columns as unknown[]).map(String)
            : undefined;
          const dataRows = Array.isArray(row.data.data)
            ? (row.data.data as unknown[]).map((r) => (Array.isArray(r) ? r : [r]))
            : undefined;
          return { urn: row.urn, status: "found", columns, dataRows };
        }
        return { urn: row.urn, status: "error", error: row.error };
      });
      setWdmsResults(parsed);
      setWdmsOpen(true);
    } catch (error) {
      if (isAbortError(error)) return;
      setWdmsError("Failed to connect to WDMS");
      setWdmsOpen(true);
    } finally {
      if (wdmsAbortControllerRef.current === controller) wdmsAbortControllerRef.current = null;
      setWdmsLoading(false);
    }
  }, [selectedUrns, wdmsLoading]);

  // RDMS lookup: detect UUID in selectedText, resolve $type from JSON context
  const selectedUuid = useMemo(() => {
    if (!activeRdmsContext || !_isFullscreen) return null;
    const t = selectedText.trim();
    return UUID_RE.test(t) ? t : null;
  }, [activeRdmsContext, _isFullscreen, selectedText]);

  const rdmsDatatype = useMemo(() => {
    if (!selectedUuid || !parsedJson) return null;
    return findObjectTypeForUuid(parsedJson, selectedUuid);
  }, [selectedUuid, parsedJson]);

  // Array paths belong to the Reservoir response currently shown in the viewer.
  // Using the original Storage/Search JSON here makes a valid RDDMS overlay fail
  // with misleading missing-path errors.
  const parsedArrayJson = parsedJson;
  const rdmsArrayType = useMemo((): RdmsArrayType | null => {
    if (!activeRdmsContext) return null;
    // Prefer the datatype passed directly via rdmsContext (set from the resource selection),
    // fall back to parsing $type from the JSON root.
    const candidate = activeRdmsContext.datatype ?? getRootField<string>(parsedArrayJson, "$type");
    if (typeof candidate === "string" && (RDMS_ARRAY_TYPES as readonly string[]).includes(candidate)) {
      return candidate as RdmsArrayType;
    }
    return null;
  }, [activeRdmsContext, parsedArrayJson]);
  const rdmsRootUuid = useMemo(
    () => activeRdmsContext?.uuid ?? getRootUuid(parsedArrayJson),
    [activeRdmsContext, parsedArrayJson],
  );

  const handleRdmsLookup = useCallback(async () => {
    if (!selectedUuid || !activeRdmsContext || lookupLoading) return;
    setLookupLoading("search");
    setLookupError(null);
    const datatype = rdmsDatatype ?? "";
    try {
      const url = `/api/osdu/rdms/dataspaces/${encodeURIComponent(activeRdmsContext.dataspace)}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(selectedUuid)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setLookupError(err.error ?? "Failed to fetch RDMS record");
        return;
      }
      const data: unknown = await res.json();
      setOverlayJson(JSON.stringify(data, null, 2));
      setOverlayLabel(selectedUuid);
    } catch {
      setLookupError("Failed to fetch RDMS record");
    } finally {
      setLookupLoading(null);
    }
  }, [selectedUuid, activeRdmsContext, rdmsDatatype, lookupLoading]);

  const handleArrayData = useCallback(async () => {
    if (!activeRdmsContext || !parsedArrayJson || !rdmsArrayType || !rdmsRootUuid) return;
    const finishActivity = startActivity("Loading array data");
    setArrayOpen(true);
    setArrayLoading(true);
    setArrayError(null);
    setArrayResults([]);
    const controller = new AbortController();
    arrayAbortControllerRef.current = controller;

    const ds = encodeURIComponent(activeRdmsContext.dataspace);
    const dt = encodeURIComponent(rdmsArrayType);
    const uid = encodeURIComponent(rdmsRootUuid);
    const base = `/api/osdu/rdms/dataspaces/${ds}/resources/${dt}/${uid}/arrays`;

    async function fetchArrayPath(hdfPath: string): Promise<ArrayDataResult> {
      const res = await fetch(`${base}?path=${encodeURIComponent(hdfPath)}`, { signal: controller.signal });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        return { label: hdfPath, error: err.error ?? `HTTP ${res.status}` };
      }
      const payload = await res.json() as { data?: { data?: unknown; dimensions?: number[] } };
      const data = Array.isArray(payload.data?.data) ? payload.data.data as unknown[] : [];
      const dimensions = Array.isArray(payload.data?.dimensions) ? payload.data.dimensions as number[] : [data.length];
      return { label: hdfPath, dimensions, data };
    }

    try {
      // The API may return an array of records; always use the first element.
      const recordRoot: JsonValue = Array.isArray(parsedArrayJson)
        ? (parsedArrayJson as JsonValue[])[0] ?? null
        : parsedArrayJson;
      const root = recordRoot ? unwrapRecordData(recordRoot) : null;

      if (!root || typeof root !== "object" || Array.isArray(root)) {
        setArrayError("JSON root is not an object (empty or unexpected structure)");
        return;
      }

      if (rdmsArrayType === "resqml20.obj_Grid2dRepresentation") {
        const result = traversePathDebug(
          root,
          ["Grid2dPatch", "Geometry", "Points", "ZValues", "Values", "PathInHdfFile"],
        );
        if (!result.ok) { setArrayError(formatPathError(result)); return; }
        setArrayResults([await fetchArrayPath(result.value)]);

      } else if (rdmsArrayType === "resqml20.obj_PolylineSetRepresentation") {
        // Resolve LinePatch (may be an array — use first element)
        const rawLinePatch = (root as Record<string, JsonValue>)["LinePatch"] ?? null;
        const patch: JsonValue = Array.isArray(rawLinePatch)
          ? (rawLinePatch as JsonValue[])[0] ?? null
          : rawLinePatch;

        if (!patch) {
          const availableKeys = Object.keys(root as Record<string, JsonValue>);
          const keysStr = `[${availableKeys.join(", ")}]`;
          console.log("[ArrayData] LinePatch => FAILED. Top-level keys:", availableKeys);
          setArrayError(`Path not found: 'LinePatch' not found under '(root)'. Available keys: ${keysStr}`);
          return;
        }
        console.log("[ArrayData] LinePatch => OK (using index 0 if array)");

        const results: ArrayDataResult[] = [];

        const ncResult = traversePathDebug(patch, ["NodeCountPerPolyline", "Values", "PathInHdfFile"], "LinePatch[0]");
        results.push(ncResult.ok
          ? await fetchArrayPath(ncResult.value)
          : { label: "LinePatch.NodeCountPerPolyline.Values.PathInHdfFile", error: formatPathError(ncResult) });

        const coordResult = traversePathDebug(patch, ["Geometry", "Points", "Coordinates", "PathInHdfFile"], "LinePatch[0]");
        results.push(coordResult.ok
          ? await fetchArrayPath(coordResult.value)
          : { label: "LinePatch.Geometry.Points.Coordinates.PathInHdfFile", error: formatPathError(coordResult) });

        setArrayResults(results);
      }
    } catch (error) {
      if (isAbortError(error)) return;
      setArrayError("Failed to fetch array data");
    } finally {
      if (arrayAbortControllerRef.current === controller) arrayAbortControllerRef.current = null;
      setArrayLoading(false);
      finishActivity();
    }
  }, [activeRdmsContext, parsedArrayJson, rdmsArrayType, rdmsRootUuid, startActivity]);

  const handleVisualizeGrid2d = useCallback(async () => {
    if (!activeRdmsContext || !parsedArrayJson || !rdmsRootUuid) return;
    if (rdmsArrayType !== "resqml20.obj_Grid2dRepresentation") return;
    const finishActivity = startActivity("Loading grid surface");
    setGrid2dOpen(true);
    setGrid2dLoading(true);
    setGrid2dError(null);
    setGrid2dSurface(null);
    const controller = new AbortController();
    grid2dAbortControllerRef.current = controller;

    const ds = encodeURIComponent(activeRdmsContext.dataspace);
    const dt = encodeURIComponent(rdmsArrayType);
    const uid = encodeURIComponent(rdmsRootUuid);
    const base = `/api/osdu/rdms/dataspaces/${ds}/resources/${dt}/${uid}/arrays`;

    try {
      const recordRoot: JsonValue = Array.isArray(parsedArrayJson)
        ? (parsedArrayJson as JsonValue[])[0] ?? null
        : parsedArrayJson;
      const root = recordRoot ? unwrapRecordData(recordRoot) : null;
      if (!root || typeof root !== "object" || Array.isArray(root)) {
        setGrid2dError("JSON root is not an object (empty or unexpected structure)");
        return;
      }

      const zPath = traversePathDebug(
        root,
        ["Grid2dPatch", "Geometry", "Points", "ZValues", "Values", "PathInHdfFile"],
      );
      if (!zPath.ok) { setGrid2dError(formatPathError(zPath)); return; }

      const res = await fetch(`${base}?path=${encodeURIComponent(zPath.value)}`, { signal: controller.signal });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setGrid2dError(err.error ?? `Failed to fetch Z values (HTTP ${res.status})`);
        return;
      }
      const payload = await res.json() as { data?: { data?: unknown; dimensions?: number[] } };
      const rawData = Array.isArray(payload.data?.data) ? payload.data.data as unknown[] : [];
      const dimensions = Array.isArray(payload.data?.dimensions) ? payload.data.dimensions as number[] : undefined;

      const meta = resolveGrid2dMeta(root);
      const built = buildGrid2dSurface(meta, rawData, dimensions);
      if ("error" in built) { setGrid2dError(built.error); return; }
      setGrid2dSurface(built.surface);
    } catch (error) {
      if (isAbortError(error)) return;
      setGrid2dError("Failed to load grid surface");
    } finally {
      if (grid2dAbortControllerRef.current === controller) grid2dAbortControllerRef.current = null;
      setGrid2dLoading(false);
      finishActivity();
    }
  }, [activeRdmsContext, parsedArrayJson, rdmsArrayType, rdmsRootUuid, startActivity]);

  const isGrid2dRepresentation = rdmsArrayType === "resqml20.obj_Grid2dRepresentation";

  const canEditRdms = Boolean(
    activeRdmsContext?.dataspace && activeRdmsContext?.datatype && activeRdmsContext?.uuid,
  );

  const canEditStorage = Boolean(
    originalResponseType === "storage" && !activeRdmsContext && !overlayJson && !lookupResult,
  );

  const openEdit = useCallback(() => {
    setEditDraft(displayJson);
    setEditParseError(null);
    setEditSaveError(null);
    setEditSaveStep(null);
    setEditOpen(true);
  }, [displayJson]);

  const handleEditChange = useCallback((value: string) => {
    setEditDraft(value);
    if (value.trim() === "") {
      setEditParseError("JSON is empty");
      return;
    }
    try {
      JSON.parse(value);
      setEditParseError(null);
    } catch (err) {
      setEditParseError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }, []);

  const saveEdit = useCallback(async () => {
    if (!activeRdmsContext?.dataspace && !canEditStorage) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editDraft);
    } catch (err) {
      setEditParseError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    const records = Array.isArray(parsed) ? parsed : [parsed];
    setEditSaving(true);
    setEditSaveError(null);
    const result = activeRdmsContext?.dataspace
      ? await saveRdmsRecord(activeRdmsContext.dataspace, records, setEditSaveStep)
      : await saveStorageRecord(records, setEditSaveStep);
    setEditSaving(false);
    setEditSaveStep(null);
    if (result.ok) {
      setEditOpen(false);
    } else {
      setEditSaveError(result.error);
    }
  }, [activeRdmsContext, canEditStorage, editDraft]);

  const openDeleteConfirm = useCallback(async () => {
    setDeleteError(null);
    setReferencers(null);
    setReferencersTruncated(false);
    setBlastAck(false);
    setDeleteConfirmOpen(true);
    if (!activeRdmsContext?.dataspace || !activeRdmsContext?.datatype || !activeRdmsContext?.uuid) return;
    // Preview the blast radius before offering the delete: list the records that
    // reference this one, since Reservoir DDMS refuses to delete a referenced
    // record on its own.
    setCheckingRefs(true);
    const result = await discoverRdmsReferencers(
      activeRdmsContext.dataspace,
      activeRdmsContext.datatype,
      activeRdmsContext.uuid,
    );
    setCheckingRefs(false);
    // If discovery fails, fall back to a plain single delete: the delete itself
    // will still surface a 412 with guidance if references actually exist.
    setReferencers(result.ok ? result.referencers : []);
    setReferencersTruncated(result.ok ? result.truncated : false);
  }, [activeRdmsContext]);

  const confirmDelete = useCallback(async () => {
    if (!activeRdmsContext?.dataspace || !activeRdmsContext?.datatype || !activeRdmsContext?.uuid) return;
    setDeleting(true);
    setDeleteError(null);
    const refs = referencers ?? [];
    // With referencers, delete them and the target atomically in one transaction;
    // without, the single self-committing DELETE is enough (and avoids the extra
    // transaction round-trips).
    const result =
      refs.length > 0
        ? await cascadeDeleteRdmsRecord(
            activeRdmsContext.dataspace,
            activeRdmsContext.datatype,
            activeRdmsContext.uuid,
            refs,
          )
        : await deleteRdmsRecord(
            activeRdmsContext.dataspace,
            activeRdmsContext.datatype,
            activeRdmsContext.uuid,
          );
    setDeleting(false);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }
    setDeleteConfirmOpen(false);
    setEditOpen(false);
    if (lookupResult) {
      onLookupResult?.(null);
    } else if (overlayJson) {
      setOverlayJson(null);
      setOverlayLabel(null);
      setResolvedRdmsContext(null);
    }
    onRecordDeleted?.();
  }, [activeRdmsContext, referencers, lookupResult, overlayJson, onLookupResult, onRecordDeleted]);

  const openStorageDeleteConfirm = useCallback(() => {
    const previewRun = ++storageDdmsPreviewRunRef.current;
    const targets = storageDdmsScan.targets;
    setStorageDeleteError(null);
    setDeleteLinkedDdms(false);
    setStorageDeleteStep(null);
    setStorageDdmsDeleteOutcomes([]);
    setStorageDeleteCompletion(null);
    setStorageDdmsBlastAck(false);
    setStorageDdmsCascadePreview({
      groups: [],
      checkedCount: 0,
      totalCount: targets.length,
      loading: targets.length > 0,
      truncated: false,
      error: null,
    });
    setStorageDeleteConfirmOpen(true);
    if (targets.length === 0) return;

    void (async () => {
      let groups: StorageDdmsCascadeGroup[] = [];
      let truncated = false;
      for (const [index, target] of targets.entries()) {
        const result = await discoverRdmsReferencers(target.dataspace, target.datatype, target.uuid);
        if (previewRun !== storageDdmsPreviewRunRef.current) return;
        if (!result.ok) {
          setStorageDdmsCascadePreview({
            groups,
            checkedCount: index,
            totalCount: targets.length,
            loading: false,
            truncated,
            error: `Could not check references for ${formatReservoirDdmsId(target)}. ${result.error}`,
          });
          return;
        }

        groups = [...groups, { target, referencers: result.referencers }];
        truncated ||= result.truncated;
        setStorageDdmsCascadePreview({
          groups,
          checkedCount: index + 1,
          totalCount: targets.length,
          loading: index + 1 < targets.length,
          truncated,
          error: null,
        });
      }
    })();
  }, [storageDdmsScan.targets]);

  useEffect(() => {
    if (!openStorageDeleteRequestId) {
      handledStorageDeleteRequestRef.current = null;
      return;
    }
    if (
      handledStorageDeleteRequestRef.current === openStorageDeleteRequestId ||
      openStorageDeleteRequestId !== displayedRecordId
    ) {
      return;
    }

    handledStorageDeleteRequestRef.current = openStorageDeleteRequestId;
    onStorageDeleteRequestHandled?.();
    openStorageDeleteConfirm();
  }, [
    displayedRecordId,
    onStorageDeleteRequestHandled,
    openStorageDeleteConfirm,
    openStorageDeleteRequestId,
  ]);

  useEffect(() => {
    if (!openRdmsDeleteRequestId) {
      handledRdmsDeleteRequestRef.current = null;
      return;
    }
    if (
      handledRdmsDeleteRequestRef.current === openRdmsDeleteRequestId ||
      openRdmsDeleteRequestId !== activeRdmsContext?.uuid ||
      !canEditRdms
    ) {
      return;
    }

    handledRdmsDeleteRequestRef.current = openRdmsDeleteRequestId;
    onRdmsDeleteRequestHandled?.();
    void openDeleteConfirm();
  }, [
    activeRdmsContext?.uuid,
    canEditRdms,
    onRdmsDeleteRequestHandled,
    openDeleteConfirm,
    openRdmsDeleteRequestId,
  ]);

  const runStorageDelete = useCallback(
    async (mode: "soft" | "purge") => {
      if (!displayedRecordId || storageDeleting) return;
      if (deleteLinkedDdms && !storageDdmsPreviewComplete) {
        setStorageDeleteError(
          "The Reservoir DDMS reference list is incomplete, so linked DDMS deletion is disabled. You can retry the preview or delete only the Storage record.",
        );
        return;
      }
      if (
        deleteLinkedDdms &&
        storageDdmsPlanEntries.length >= BLAST_RADIUS_THRESHOLD &&
        !storageDdmsBlastAck
      ) {
        setStorageDeleteError("Acknowledge the full Reservoir DDMS deletion list before continuing.");
        return;
      }
      setStorageDeleting(mode);
      setStorageDeleteError(null);
      let storageRequestStarted = false;
      try {
        const outcomes = new Map(
          storageDdmsDeleteOutcomes.map((outcome) => [
            reservoirDdmsTargetKey(outcome.target),
            outcome,
          ]),
        );
        if (deleteLinkedDdms) {
          const planEntriesByKey = new Map(
            storageDdmsPlanEntries.map((entry) => [reservoirDdmsTargetKey(entry.target), entry]),
          );
          for (const [index, group] of storageDdmsCascadePreview.groups.entries()) {
            const targetKey = reservoirDdmsTargetKey(group.target);
            if (outcomes.has(targetKey)) continue;

            const referencersByKey = new Map<string, ReservoirDdmsTarget>();
            for (const referencer of group.referencers) {
              const referencerTarget = {
                dataspace: group.target.dataspace,
                datatype: referencer.datatype,
                uuid: referencer.uuid,
              };
              const referencerKey = reservoirDdmsTargetKey(referencerTarget);
              if (referencerKey === targetKey || outcomes.has(referencerKey)) continue;
              referencersByKey.set(referencerKey, referencerTarget);
            }
            const referencerTargets = [...referencersByKey.values()];
            setStorageDeleteStep(
              `Deleting Reservoir DDMS cascade ${index + 1} of ${storageDdmsCascadePreview.groups.length}: ${formatReservoirDdmsId(group.target)}…`,
            );
            const result = referencerTargets.length > 0
              ? await cascadeDeleteRdmsRecord(
                  group.target.dataspace,
                  group.target.datatype,
                  group.target.uuid,
                  referencerTargets,
                )
              : await deleteRdmsRecord(
                  group.target.dataspace,
                  group.target.datatype,
                  group.target.uuid,
                );
            if (!result.ok && result.status !== 404) {
              setStorageDeleteError(
                `Could not delete Reservoir DDMS record ${formatReservoirDdmsId(group.target)}. The Storage record was not deleted. ${
                  referencerTargets.length > 0
                    ? getRdmsCascadeGuidance(result.error)
                    : getRdmsDeleteGuidance(result.error)
                }`,
              );
              return;
            }

            if (!result.ok && referencerTargets.length > 0) {
              setStorageDeleteError(
                `Could not delete Reservoir DDMS record ${formatReservoirDdmsId(group.target)}. The Storage record was not deleted. ${getRdmsCascadeGuidance(result.error)}`,
              );
              return;
            }

            const completedTargets = result.ok
              ? [group.target, ...referencerTargets]
              : [group.target];
            for (const target of completedTargets) {
              const key = reservoirDdmsTargetKey(target);
              const planEntry = planEntriesByKey.get(key);
              outcomes.set(key, {
                target,
                status: result.ok ? "deleted" : "already-absent",
                linkedFromStorage: planEntry?.linkedFromStorage ?? false,
                cascadeFor: planEntry?.cascadeFor ?? [],
              });
            }
            setStorageDdmsDeleteOutcomes([...outcomes.values()]);
          }
        }

        setStorageDeleteStep(
          mode === "soft"
            ? "Soft deleting the Storage record…"
            : "Purging the Storage record…",
        );
        storageRequestStarted = true;
        const result = mode === "soft"
          ? await softDeleteStorageRecord(displayedRecordId)
          : await purgeStorageRecord(displayedRecordId);
        if (!result.ok) {
          setStorageDeleteError(result.error);
          return;
        }

        const completion: StorageDeleteCompletion = {
          mode,
          recordId: displayedRecordId,
          ddmsOutcomes: [...outcomes.values()],
        };
        storageDdmsPreviewRunRef.current++;
        setStorageDeleteConfirmOpen(false);
        setEditOpen(false);
        setStorageDeleteCompletion(completion);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStorageDeleteError(
          storageRequestStarted
            ? `The Storage delete request did not return a result. Check the record in Storage Service before retrying. ${detail}`
            : `The Storage record was not deleted because the linked-record deletion did not complete. ${detail}`,
        );
      } finally {
        setStorageDeleting(null);
        setStorageDeleteStep(null);
      }
    },
    [
      displayedRecordId,
      storageDeleting,
      storageDdmsDeleteOutcomes,
      deleteLinkedDdms,
      storageDdmsCascadePreview,
      storageDdmsPlanEntries,
      storageDdmsPreviewComplete,
      storageDdmsBlastAck,
    ],
  );

  const closeStorageDeleteCompletion = useCallback(() => {
    setStorageDeleteCompletion(null);
    onRecordDeleted?.();
  }, [onRecordDeleted]);

  const rawSegments = buildRawSegments(displayJson, rawMatches, activeIndex);
  let rawSegmentMatchIndex = -1;
  const lineWrapDisabled = viewMode !== "raw";
  const decreaseFontDisabled = viewMode !== "raw" || fontSize <= MIN_FONT_SIZE;
  const increaseFontDisabled = viewMode !== "raw" || fontSize >= MAX_FONT_SIZE;
  const selectedStorageId = extractFirstOsduId(selectedText);
  const selectedSearchId = extractFirstOsduId(selectedText);
  const hasRecordResponse = Boolean(displayedRecordId);
  const storageLookupDisabled = hasRecordResponse ? !!lookupLoading : !selectedText || !!lookupLoading;
  const searchLookupDisabled = activeRdmsContext
    ? !selectedUuid || !!lookupLoading
    : hasRecordResponse ? !!lookupLoading : !selectedText || !!lookupLoading;
  const ddmsLookupDisabled = !ddmsTarget || !!lookupLoading;
  const wdmsLookupDisabled = wdmsUrns.length === 0 || !!wdmsLoading;
  const arrayDataDisabled = !!arrayLoading;
  const matchNavigationDisabled = totalMatches === 0;

  return (
    <div ref={containerRef} className={cn("relative flex flex-col gap-1", _isFullscreen && "h-full", className)} onClick={handleContainerClick}>
      {_isFullscreen && lookupError && (
        <div className="flex items-center gap-2 rounded-md border border-error-border/60 bg-error-surface px-3 py-1.5 text-xs text-error-text animate-in fade-in slide-in-from-top-1 duration-150">
          <span className="flex-1">{lookupError}</span>
          <button
            onClick={() => setLookupError(null)}
            className="shrink-0 rounded p-0.5 hover:bg-destructive/20 transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className={cn(
        "flex items-center gap-1 rounded-t-md border border-border/40 px-2 py-1",
        _isFullscreen
          ? "bg-muted/30"
          : "sticky top-0 z-10 bg-card/95 backdrop-blur-sm",
      )}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", ENABLED_ICON_CLASS)}
              onClick={handleSelectAll}
              aria-label={allSelected ? "Unselect all" : "Select all"}
            >
              <ListChecks className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{allSelected ? "Unselect all" : "Select all"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", ENABLED_ICON_CLASS)}
              onClick={handleCopy}
              aria-label="Copy"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied!" : "Copy selection (or all)"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7 relative", ENABLED_ICON_CLASS, searchOpen && "bg-accent text-primary")}
              onClick={toggleSearch}
              aria-label="Search"
            >
              <TextSearch className="h-3.5 w-3.5" />
              {badgeRendered && (
                <span
                  className={cn(
                    "absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold leading-none text-primary-foreground pointer-events-none select-none",
                    badgeExiting
                      ? "animate-out fade-out zoom-out-75 duration-150 motion-reduce:duration-0"
                      : "animate-in fade-in zoom-in-75 duration-150 motion-reduce:duration-0",
                  )}
                >
                  {totalMatches > 99 ? "99+" : totalMatches}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Find</TooltipContent>
        </Tooltip>

        {parsedJson !== null && (
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-7 w-7",
                    ENABLED_ICON_CLASS,
                    viewMode === "tree" && "bg-accent text-primary",
                  )}
                  onClick={() => setViewMode("tree")}
                  aria-label="Tree view"
                >
                  <ListTree className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Tree view</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-7 w-7",
                    ENABLED_ICON_CLASS,
                    viewMode === "raw" && "bg-accent text-primary",
                  )}
                  onClick={() => setViewMode("raw")}
                  aria-label="Raw view"
                >
                  <Rows3 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Raw view</TooltipContent>
            </Tooltip>
          </div>
        )}

        {_isFullscreen && (
          <>
            {(Boolean(lookupResult) || Boolean(overlayJson)) && (
              <>
                <div className="w-px h-4 bg-border/60 mx-0.5 shrink-0" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-7 w-7", ENABLED_ICON_CLASS)}
                       onClick={handleBackToOriginal}
                      aria-label="Back to original"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Back to original</TooltipContent>
                </Tooltip>
                {(lookupResult?.label ?? overlayLabel) && (
                  <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                    {lookupResult?.label ?? overlayLabel}
                  </span>
                )}
              </>
            )}
            <div className="w-px h-4 bg-border/60 mx-0.5 shrink-0" />
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex"
                  tabIndex={lineWrapDisabled ? 0 : undefined}
                  aria-label={lineWrapDisabled ? (lineWrap ? "Line wrap disabled in Tree view" : "Line wrap unavailable in Tree view") : undefined}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-7 w-7",
                      iconStateClass(viewMode === "raw"),
                      viewMode === "raw" && lineWrap && "bg-accent text-primary",
                    )}
                    onClick={() => setLineWrap((v) => !v)}
                    disabled={lineWrapDisabled}
                    aria-label={lineWrap ? "Disable line wrap" : "Enable line wrap"}
                  >
                    <WrapText className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{lineWrap ? "Disable line wrap" : "Enable line wrap"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex"
                  tabIndex={decreaseFontDisabled ? 0 : undefined}
                  aria-label={decreaseFontDisabled ? "Decrease font size unavailable" : undefined}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-7 w-7",
                      iconStateClass(viewMode === "raw" && fontSize > MIN_FONT_SIZE),
                    )}
                    onClick={() => setFontSize((s) => Math.max(MIN_FONT_SIZE, s - 1))}
                    disabled={decreaseFontDisabled}
                    aria-label="Decrease font size"
                  >
                    <span className="text-[10px] font-bold font-mono leading-none select-none">A-</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Decrease font size</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex"
                  tabIndex={increaseFontDisabled ? 0 : undefined}
                  aria-label={increaseFontDisabled ? "Increase font size unavailable" : undefined}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-7 w-7",
                      iconStateClass(viewMode === "raw" && fontSize < MAX_FONT_SIZE),
                    )}
                    onClick={() => setFontSize((s) => Math.min(MAX_FONT_SIZE, s + 1))}
                    disabled={increaseFontDisabled}
                    aria-label="Increase font size"
                  >
                    <span className="text-[13px] font-bold font-mono leading-none select-none">A+</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Increase font size</TooltipContent>
            </Tooltip>

            <div className="w-px h-4 bg-border/60 mx-0.5 shrink-0" />

            {!hideStorageLookup && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex"
                    tabIndex={storageLookupDisabled ? 0 : undefined}
                    aria-label={storageLookupDisabled ? "Storage lookup unavailable until a record ID is available" : undefined}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-7 w-7", iconStateClass(!storageLookupDisabled))}
                      onClick={() => { void handleStorageLookup(); }}
                      aria-label="Open record in Storage API"
                      disabled={storageLookupDisabled}
                    >
                      {lookupLoading === "storage" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <DatabaseZap className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {selectedStorageId
                    ? `Storage record for selected ID: ${selectedStorageId}`
                    : displayedRecordId
                      ? `Storage record: ${displayedRecordId}`
                      : (selectedText ? "Look up in Storage" : "Select text to look up in Storage")}
                </TooltipContent>
              </Tooltip>
            )}

            {!hideSearchLookup && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex"
                    tabIndex={searchLookupDisabled ? 0 : undefined}
                    aria-label={searchLookupDisabled ? (activeRdmsContext ? "Reservoir DDMS lookup unavailable until a UUID is selected" : "Search unavailable until a record ID is available") : undefined}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-7 w-7",
                        iconStateClass(!searchLookupDisabled),
                      )}
                      onClick={() => { rdmsContext ? void handleRdmsLookup() : void handleSearchLookup(); }}
                      aria-label={rdmsContext ? "Look up UUID in Reservoir DDMS" : "Search record in Search API"}
                      disabled={searchLookupDisabled}
                    >
                      {lookupLoading === "search" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : rdmsContext ? (
                        <Search className="h-3.5 w-3.5" />
                      ) : (
                        <FileSearch2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {rdmsContext
                    ? (selectedUuid ? "Look up UUID in Reservoir DDMS" : "Click a UUID value to enable lookup")
                    : selectedSearchId
                      ? `Search selected ID: ${selectedSearchId}`
                      : displayedRecordId
                        ? `Search record: ${displayedRecordId}`
                        : (selectedText ? "Search by ID" : "Select text to search by ID")}
                </TooltipContent>
              </Tooltip>
            )}

            {!hideDdmsLookup && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex"
                    tabIndex={ddmsLookupDisabled ? 0 : undefined}
                    aria-label={ddmsLookupDisabled ? "Reservoir DDMS unavailable for this record" : undefined}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-7 w-7", iconStateClass(!ddmsLookupDisabled))}
                      onClick={() => { void handleDdmsLookup(); }}
                      aria-label="Open record in Reservoir DDMS"
                      disabled={ddmsLookupDisabled}
                    >
                      {lookupLoading === "ddms" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ReservoirDdmsIcon className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {ddmsTarget
                    ? `Open Reservoir DDMS record (${ddmsTarget.dataspace})`
                    : "Reservoir DDMS unavailable: no DDMS dataset is listed"}
                </TooltipContent>
              </Tooltip>
            )}

            {!hideWdmsLookup && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex"
                    tabIndex={wdmsLookupDisabled ? 0 : undefined}
                    aria-label={wdmsLookupDisabled ? "Wellbore DDMS search unavailable until a WellLog or WellboreTrajectory ID is selected" : undefined}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-7 w-7", iconStateClass(!wdmsLookupDisabled))}
                      onClick={() => { void handleWdmsSearch(); }}
                      aria-label="Search Wellbore DDMS"
                      disabled={wdmsLookupDisabled}
                    >
                      {wdmsLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <WellboreDmsIcon className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {wdmsUrns.length > 0
                    ? `Search Wellbore DDMS (${wdmsUrns.length} ID${wdmsUrns.length > 1 ? "s" : ""})`
                    : selectedUrns.length > 0
                      ? "Selected IDs are not WellLog or WellboreTrajectory"
                      : "Select a WellLog or WellboreTrajectory ID to search Wellbore DDMS"}
                </TooltipContent>
              </Tooltip>
            )}

            {canEditRdms && (
              <>
                <div className="w-px h-4 bg-border/60 mx-0.5 shrink-0" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-7 w-7", iconStateClass(!editSaving))}
                      onClick={openEdit}
                      aria-label="Edit record in Reservoir DDMS"
                      disabled={editSaving}
                    >
                      {editSaving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Pencil className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit &amp; save record in Reservoir DDMS</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-7 w-7", iconStateClass(!deleting), "text-destructive hover:text-destructive")}
                      onClick={() => { void openDeleteConfirm(); }}
                      aria-label="Delete record in Reservoir DDMS"
                      disabled={deleting}
                    >
                      {deleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete record from Reservoir DDMS</TooltipContent>
                </Tooltip>
              </>
            )}

            {canEditStorage && (
              <>
                <div className="w-px h-4 bg-border/60 mx-0.5 shrink-0" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-7 w-7", iconStateClass(!editSaving))}
                      onClick={openEdit}
                      aria-label="Edit record in Storage Service"
                      disabled={editSaving}
                    >
                      {editSaving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Pencil className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit &amp; save record in Storage Service</TooltipContent>
                </Tooltip>
                {displayedRecordId && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn("h-7 w-7", iconStateClass(!storageDeleting), "text-destructive hover:text-destructive")}
                        onClick={openStorageDeleteConfirm}
                        aria-label="Delete record in Storage Service"
                        disabled={Boolean(storageDeleting)}
                      >
                        {storageDeleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete record from Storage Service</TooltipContent>
                  </Tooltip>
                )}
              </>
            )}

            {activeRdmsContext && rdmsArrayType && (
              <>
                <div className="w-px h-4 bg-border/60 mx-0.5 shrink-0" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-flex"
                      tabIndex={arrayDataDisabled ? 0 : undefined}
                      aria-label={arrayDataDisabled ? "Array data unavailable while loading" : undefined}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn("h-7 w-7", iconStateClass(!arrayDataDisabled))}
                        onClick={() => { void handleArrayData(); }}
                        aria-label="Get array data from Reservoir DDMS"
                        disabled={arrayDataDisabled}
                      >
                        {arrayLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Grid3x3 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Get Array Data from Reservoir DDMS</TooltipContent>
                </Tooltip>

                {isGrid2dRepresentation && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex"
                        tabIndex={grid2dLoading ? 0 : undefined}
                        aria-label={grid2dLoading ? "Surface visualization unavailable while loading" : undefined}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn("h-7 w-7", iconStateClass(!grid2dLoading))}
                          onClick={() => { void handleVisualizeGrid2d(); }}
                          aria-label="Visualize Grid2d surface"
                          disabled={grid2dLoading}
                        >
                          {grid2dLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Mountain className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Visualize Grid2d Surface (3D)</TooltipContent>
                  </Tooltip>
                )}
              </>
            )}

          </>
        )}

        {!_isFullscreen && (onMaximize || onPopOut) && (
          <div className="flex items-center gap-1 ml-auto">
            {onMaximize && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-7 w-7", ENABLED_ICON_CLASS)}
                    onClick={onMaximize}
                    aria-label="Expand to full screen"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Full screen</TooltipContent>
              </Tooltip>
            )}
            {onPopOut && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-7 w-7", ENABLED_ICON_CLASS)}
                    onClick={onPopOut}
                    aria-label="Pop out in new tab"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Pop out in new tab</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {searchOpen && (
          <div className={cn("flex flex-1 items-center gap-1", !_isFullscreen && (onMaximize || onPopOut) ? "mr-0" : "ml-1")}>
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKey}
              placeholder="Find…"
              className="h-6 flex-1 px-2 py-0 text-xs font-mono"
            />
            <span className="min-w-[4rem] text-center text-xs text-muted-foreground">
              {totalMatches === 0
                ? query
                  ? "No results"
                  : ""
                : `${activeIndex + 1} / ${totalMatches}`}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex"
                  tabIndex={matchNavigationDisabled ? 0 : undefined}
                  aria-label={matchNavigationDisabled ? "Previous match unavailable" : undefined}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-6 w-6", iconStateClass(!matchNavigationDisabled))}
                    onClick={goPrev}
                    disabled={matchNavigationDisabled}
                    aria-label="Previous match"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Previous match</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex"
                  tabIndex={matchNavigationDisabled ? 0 : undefined}
                  aria-label={matchNavigationDisabled ? "Next match unavailable" : undefined}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-6 w-6", iconStateClass(!matchNavigationDisabled))}
                    onClick={goNext}
                    disabled={matchNavigationDisabled}
                    aria-label="Next match"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Next match</TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-6 w-6", ENABLED_ICON_CLASS)}
              onClick={closeAndClearSearch}
              aria-label="Close search"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {showTree ? (
        <div
          ref={treeRef}
          className={cn(_isFullscreen && "flex-1 overflow-auto min-h-0 rounded-b-lg border border-t-0 border-border/40 bg-muted/50 p-4")}
          style={_isFullscreen ? { fontSize: `${fontSize}px` } : undefined}
        >
          <JsonTreeView
            parsed={parsedJson}
            storageKey={
              lookupResult
                ? (lookupResult.storageKey ?? lookupResult.label)
                : (overlayJson ? (overlayLabel ?? undefined) : storageKey)
            }
            treeMatches={treeMatches}
            activeMatchIndex={searchOpen ? activeIndex : -1}
            onActiveRef={handleActiveTreeRef}
            onMatchClick={searchOpen ? setActiveIndex : undefined}
            sharedState={lookupResult || overlayJson ? undefined : sharedTreeState}
          />
        </div>
      ) : (
        <pre
          ref={preRef}
          className={cn(
            "font-mono bg-muted/50 rounded-b-lg p-4 border border-t-0 border-border/40 text-foreground/90 leading-relaxed",
            lineWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre overflow-x-auto",
            _isFullscreen && "flex-1 overflow-auto min-h-0",
          )}
          style={{ fontSize: `${fontSize}px` }}
        >
          {rawMatches.length > 0
            ? rawSegments.map((seg, i) => {
                if (seg.highlight) {
                  rawSegmentMatchIndex++;
                  const isActive = seg.active;
                  const capturedIndex = rawSegmentMatchIndex;
                  return (
                    <mark
                      key={i}
                      ref={isActive ? activeRawMatchRef : undefined}
                      onClick={() => setActiveIndex(capturedIndex)}
                      className={cn(
                        "rounded-sm cursor-pointer",
                        isActive
                          ? "bg-orange-400/80 text-foreground"
                          : "bg-yellow-300/70 text-foreground",
                      )}
                    >
                      {seg.text}
                    </mark>
                  );
                }
                return <span key={i}>{seg.text}</span>;
              })
            : displayJson}
        </pre>
      )}

      {/* Wellbore DDMS results dialog */}
      <Dialog open={wdmsOpen} onOpenChange={setWdmsOpen}>
        <DialogContent className="max-w-6xl w-full flex flex-col gap-3" style={{ maxHeight: "90vh" }}>
          <DialogTitle className="flex items-center gap-2">
            <WellboreDmsIcon className="h-4 w-4 text-cyan-500" />
            Wellbore DDMS Results
            {wdmsResults.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {wdmsResults.length} record{wdmsResults.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </DialogTitle>
          {wdmsError && (
            <div className="rounded-md border border-error-border/60 bg-error-surface px-3 py-2 text-xs text-error-text">
              {wdmsError}
            </div>
          )}
          {!wdmsError && wdmsResults.length === 0 && (
            <div className="text-xs text-muted-foreground py-4 text-center">No results returned.</div>
          )}
          {wdmsResults.length > 0 && (
            <ScrollArea className="flex-1 min-h-0" style={{ maxHeight: "75vh" }}>
              <div className="flex flex-col gap-6">
                {wdmsResults.map((result, ri) => (
                  <div key={ri} className="flex flex-col gap-2">
                    {wdmsResults.length > 1 && (
                      <div className="text-[11px] font-mono text-cyan-500 break-all px-1">
                        {result.urn}
                      </div>
                    )}
                    {result.status === "error" ? (
                      <div className="rounded-md border border-error-border/60 bg-error-surface px-3 py-2 text-xs text-error-text">
                        {result.error ?? "Error fetching data"}
                      </div>
                    ) : result.columns && result.dataRows ? (
                      <div className="rounded-md border border-border/50 overflow-hidden">
                        <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-muted/40">
                                <TableHead className="whitespace-nowrap font-semibold text-xs py-2 px-3 text-muted-foreground sticky left-0 bg-muted/40 z-10">
                                  #
                                </TableHead>
                                {result.columns.map((col) => (
                                  <TableHead key={col} className="whitespace-nowrap font-semibold text-xs py-2 px-3">
                                    {col}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {result.dataRows.map((row, rowIdx) => (
                                <TableRow key={rowIdx} className="hover:bg-muted/30">
                                  <TableCell className="text-xs py-1.5 px-3 tabular-nums text-muted-foreground sticky left-0 bg-background z-10 border-r border-border/30">
                                    {rowIdx + 1}
                                  </TableCell>
                                  {result.columns!.map((col, colIdx) => {
                                    const val = row[colIdx];
                                    return (
                                      <TableCell key={col} className="text-xs py-1.5 px-3 tabular-nums">
                                        {val === undefined || val === null
                                          ? <span className="text-muted-foreground/40">—</span>
                                          : typeof val === "number"
                                            ? val
                                            : typeof val === "object"
                                              ? <span className="font-mono text-muted-foreground">{JSON.stringify(val)}</span>
                                              : String(val)}
                                      </TableCell>
                                    );
                                  })}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        <div className="px-3 py-1.5 border-t border-border/40 bg-muted/20 text-[11px] text-muted-foreground">
                          {result.dataRows.length} row{result.dataRows.length !== 1 ? "s" : ""} · {result.columns.length} column{result.columns.length !== 1 ? "s" : ""}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic px-1">
                        Response did not contain a <code className="font-mono">columns</code> / <code className="font-mono">data</code> array.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Array Data overlay — constrained to the JSON viewer area */}
      {arrayOpen && (
        <div className="absolute inset-0 z-[60] bg-background flex flex-col rounded-lg overflow-hidden border border-border/40">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-4 py-2 shrink-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Grid3x3 className="h-4 w-4 text-emerald-500" />
              Array Data — Reservoir DDMS
              {rdmsArrayType && (
                <Badge variant="secondary" className="ml-1 text-xs font-mono font-normal">
                  {rdmsArrayType}
                </Badge>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setArrayOpen(false)} aria-label="Close">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </div>

          {/* Body */}
          <div className="flex flex-col flex-1 min-h-0 gap-4 overflow-hidden p-4">
            {arrayLoading && (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Fetching array data…</span>
              </div>
            )}

            {!arrayLoading && arrayError && (
              <div className="flex items-start gap-2 rounded-md border border-error-border/60 bg-error-surface px-3 py-2 text-xs text-error-text">
                <span className="min-w-0 flex-1 break-words">{arrayError}</span>
                <CopyErrorButton error={arrayError} />
              </div>
            )}

            {!arrayLoading && !arrayError && arrayResults.length === 0 && (
              <div className="text-xs text-muted-foreground py-4 text-center">No data returned.</div>
            )}

            {!arrayLoading && arrayResults.length > 0 && (
              <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-hidden">
                {arrayResults.map((result, ri) => (
                  <div key={ri} className="flex-1 min-h-0 flex flex-col" style={{ minHeight: "120px" }}>
                    <ArrayDataTable result={result} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Grid2d surface visualization overlay — constrained to the JSON viewer area */}
      {editOpen && (
        <div className="absolute inset-0 z-[70] bg-background flex flex-col rounded-lg overflow-hidden border border-border/40">
          <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-4 py-2 shrink-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Pencil className="h-4 w-4 text-sky-500" />
              {activeRdmsContext ? "Edit Record — Reservoir DDMS" : "Edit Record — Storage Service"}
              {(activeRdmsContext?.uuid ?? (activeRdmsContext ? undefined : displayedRecordId)) && (
                <Badge variant="secondary" className="ml-1 text-xs font-mono font-normal max-w-[280px] truncate">
                  {activeRdmsContext?.uuid ?? displayedRecordId}
                </Badge>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setEditOpen(false)}
                  aria-label="Close"
                  disabled={editSaving}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </div>

          <div className="flex flex-1 min-h-0 flex-col gap-2 p-4">
            <Textarea
              value={editDraft}
              onChange={(e) => handleEditChange(e.target.value)}
              spellCheck={false}
              className="flex-1 min-h-0 resize-none font-mono text-xs"
              aria-label="Record JSON editor"
            />
            {editParseError ? (
               <div role="alert" className="shrink-0 rounded-md border border-error-border/60 bg-error-surface px-3 py-2 text-xs text-error-text">
                Invalid JSON: {editParseError}
              </div>
            ) : (
              <div className="shrink-0 text-xs text-emerald-500">Valid JSON</div>
            )}
            {editSaveError && (
               <div role="alert" className="shrink-0 flex items-start gap-2 rounded-md border border-error-border/60 bg-error-surface px-3 py-2 text-xs text-error-text">
                <span className="min-w-0 flex-1 break-words">{editSaveError}</span>
                <CopyErrorButton error={editSaveError} />
              </div>
            )}
            <div className="shrink-0 flex items-center justify-end gap-2">
              {editSaving && editSaveStep && (
                <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {editSaveStep}
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)} disabled={editSaving}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => { void saveEdit(); }}
                disabled={editSaving || editParseError !== null}
              >
                {editSaving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={deleteConfirmOpen} onOpenChange={(open) => { if (!deleting) setDeleteConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Delete this Reservoir DDMS record?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the record from Reservoir DDMS and cannot be undone.
              {activeRdmsContext?.uuid && (
                <span className="mt-2 block font-mono text-xs text-foreground break-all">{activeRdmsContext.uuid}</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {checkingRefs && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="rdms-cascade-checking">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Checking for records that reference this one…
            </div>
          )}
          {!checkingRefs && referencers && referencers.length > 0 && (
            <div className="space-y-2" data-testid="rdms-cascade-preview">
              <div className="flex items-start gap-3 rounded-lg border-2 border-amber-500/60 bg-amber-500/15 px-4 py-3 text-sm text-amber-950 shadow-sm dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold leading-5">
                    {referencers.length} other record{referencers.length === 1 ? "" : "s"}{" "}
                    reference{referencers.length === 1 ? "s" : ""} this one
                  </p>
                  <p className="mt-1 leading-5">
                    Reservoir DDMS will not delete this record while it is referenced. To remove it, all{" "}
                    {referencers.length + 1} records must be deleted together in one transaction — all of them, or
                    none. This cannot be undone.
                  </p>
                </div>
              </div>
              <ul
                className="max-h-48 space-y-1 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs"
                data-testid="rdms-cascade-list"
              >
                {referencers.map((r) => (
                  <li key={r.uri} className="flex flex-col gap-0.5 border-b border-border/40 pb-1 last:border-b-0 last:pb-0">
                    <span className="font-medium text-foreground break-all">{r.name || r.datatype}</span>
                    <span className="font-mono text-muted-foreground break-all">{r.datatype} · {r.uuid}</span>
                  </li>
                ))}
              </ul>
              {referencersTruncated && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Only the first {referencers.length} referencing records are shown; there may be more. If so, the
                  deletion will be refused and rolled back — delete again to remove the rest.
                </p>
              )}
              {referencers.length >= BLAST_RADIUS_THRESHOLD && (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={blastAck}
                    onChange={(e) => setBlastAck(e.target.checked)}
                    data-testid="rdms-cascade-ack"
                  />
                  I understand this permanently deletes {referencers.length + 1} records.
                </label>
              )}
            </div>
          )}
          {deleteError && (
            <>
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-start gap-3 rounded-lg border-2 border-amber-500/60 bg-amber-500/15 px-4 py-3 text-sm text-amber-950 shadow-sm dark:text-amber-100"
              >
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold leading-5">Deletion blocked</p>
                  <p className="mt-1 leading-5">
                    {(referencers?.length ?? 0) > 0
                      ? getRdmsCascadeGuidance(deleteError)
                      : getRdmsDeleteGuidance(deleteError)}
                  </p>
                </div>
              </div>
               <div className="flex items-start gap-2 rounded-md border border-error-border/60 bg-error-surface px-3 py-2 text-xs text-error-text">
                <span className="min-w-0 flex-1 break-words">
                  <span className="font-medium">Technical details: </span>
                  {deleteError}
                </span>
                <CopyErrorButton error={deleteError} />
              </div>
            </>
          )}
          <AlertDialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { void confirmDelete(); }}
              disabled={
                deleting ||
                checkingRefs ||
                referencers === null ||
                (referencers.length >= BLAST_RADIUS_THRESHOLD && !blastAck)
              }
            >
              {deleting ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Deleting…
                </span>
              ) : referencers && referencers.length > 0 ? (
                `Delete ${referencers.length + 1} records`
              ) : (
                "Delete"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={storageDeleteConfirmOpen}
        onOpenChange={(open) => {
          if (!storageDeleting) {
            if (!open) storageDdmsPreviewRunRef.current++;
            setStorageDeleteConfirmOpen(open);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Delete this Storage Service record?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Choose how to delete this record. Soft delete is recoverable and keeps every version;
              purge is permanent and removes the record and all of its versions. If you choose to delete linked
              Reservoir DDMS records, the complete listed cascade runs first; Storage is deleted only if every DDMS
              deletion succeeds.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {displayedRecordId && (
            <section
              className="space-y-1 rounded-md border border-border/60 bg-muted/20 p-3"
              data-testid="storage-record-delete-target"
            >
              <p className="text-xs font-semibold">Storage Service record targeted</p>
              <div className="flex items-start justify-between gap-2">
                <code className="min-w-0 break-all text-xs">{displayedRecordId}</code>
                <CopyTextButton
                  text={displayedRecordId}
                  label="Copy Storage ID"
                  testId="button-copy-storage-id"
                />
              </div>
            </section>
          )}
          {storageDdmsScan.targets.length > 0 && (
            <section
              className="space-y-2 rounded-md border-2 border-amber-500/50 bg-amber-500/10 p-3"
              data-testid="storage-ddms-summary"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    Reservoir DDMS deletion scope ({storageDdmsPlanEntries.length} unique records)
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Includes records linked from Storage and all records that reference those DDMS records.
                  </p>
                </div>
                <CopyTextButton
                  text={formatStorageDdmsPlan(
                    displayedRecordId,
                    storageDdmsPlanEntries,
                    storageDdmsCascadePreview,
                    storageDdmsScan.unresolvedCount,
                  )}
                  label="Copy full deletion list"
                  testId="button-copy-storage-delete-plan"
                />
              </div>
              <ul className="max-h-28 space-y-1 overflow-y-auto rounded bg-background/60 p-2">
                {storageDdmsPlanEntries.map((entry, index) => {
                  const outcome = storageDdmsDeleteOutcomes.find(
                    (item) => reservoirDdmsTargetKey(item.target) === reservoirDdmsTargetKey(entry.target),
                  );
                  return (
                    <li
                      key={reservoirDdmsTargetKey(entry.target)}
                      className="flex flex-col gap-0.5 border-b border-border/40 pb-1 text-xs last:border-b-0 last:pb-0"
                      data-testid={`storage-ddms-target-${index}`}
                    >
                      {entry.name && <span className="font-medium">{entry.name}</span>}
                      <code className="break-all">{formatReservoirDdmsId(entry.target)}</code>
                      <span className="text-muted-foreground">
                        {[
                          ...(entry.linkedFromStorage ? ["linked from Storage"] : []),
                          ...(entry.cascadeFor.length > 0
                            ? [`included in cascade for ${entry.cascadeFor.join(", ")}`]
                            : []),
                        ].join(" · ")}
                      </span>
                      {outcome && (
                        <span className="font-medium text-foreground">
                          {outcome.status === "deleted" ? "deleted" : "already absent"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {storageDdmsCascadePreview.loading && (
                <p
                  role="status"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  data-testid="storage-ddms-preview-progress"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Checking references for linked records ({storageDdmsCascadePreview.checkedCount} of{" "}
                  {storageDdmsCascadePreview.totalCount})…
                </p>
              )}
              {storageDdmsCascadePreview.error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs"
                  data-testid="storage-ddms-preview-error"
                >
                  <span className="min-w-0 flex-1 break-words">
                    Linked DDMS deletion is disabled because the full reference list could not be verified.{" "}
                    {storageDdmsCascadePreview.error}
                  </span>
                  <CopyErrorButton error={storageDdmsCascadePreview.error} />
                </div>
              )}
              {storageDdmsCascadePreview.truncated && (
                <p
                  role="alert"
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
                  data-testid="storage-ddms-preview-truncated"
                >
                  Reservoir DDMS returned a truncated reference list. Linked DDMS deletion is disabled because the
                  complete set of records cannot be shown.
                </p>
              )}
              {storageDdmsScan.unresolvedCount > 0 && (
                <p
                  role="alert"
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
                  data-testid="storage-ddms-unresolved-warning"
                >
                  {storageDdmsScan.unresolvedCount} DDMS reference
                  {storageDdmsScan.unresolvedCount === 1 ? "" : "s"} could not be identified. Linked DDMS deletion is
                  disabled so no records are deleted from an incomplete list.
                </p>
              )}
              <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-primary"
                  checked={deleteLinkedDdms}
                  onChange={(event) => setDeleteLinkedDdms(event.target.checked)}
                  disabled={Boolean(storageDeleting) || !storageDdmsPreviewComplete}
                  data-testid="checkbox-delete-linked-ddms"
                />
                <span>
                  Also delete all {storageDdmsPlanEntries.length} listed Reservoir DDMS records first, including
                  records in their reference cascades, then delete the Storage record.
                </span>
              </label>
              {storageDdmsPlanEntries.length >= BLAST_RADIUS_THRESHOLD && (
                <label className="flex items-start gap-2 text-xs leading-relaxed" data-testid="storage-ddms-blast-ack">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-primary"
                    checked={storageDdmsBlastAck}
                    onChange={(event) => setStorageDdmsBlastAck(event.target.checked)}
                    disabled={Boolean(storageDeleting) || !deleteLinkedDdms}
                  />
                  <span>
                    I understand the full list includes {storageDdmsPlanEntries.length} Reservoir DDMS records and
                    they cannot be restored.
                  </span>
                </label>
              )}
            </section>
          )}
          {storageDeleteStep && (
            <p role="status" className="text-xs text-muted-foreground" data-testid="storage-delete-progress">
              {storageDeleteStep}
            </p>
          )}
          {storageDeleteError && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-error-border/60 bg-error-surface px-3 py-2 text-xs text-error-text">
              <span className="min-w-0 flex-1 break-words">{storageDeleteError}</span>
              <CopyErrorButton error={storageDeleteError} />
            </div>
          )}
          {storageDeleteError && storageDdmsDeleteOutcomes.length > 0 && displayedRecordId && (
            <div
              className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
              data-testid="storage-delete-partial-summary"
            >
              <p className="text-xs font-semibold">
                DDMS deletions already completed cannot be rolled back.
              </p>
              <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap break-all text-[11px]">
                {formatPartialStorageDeleteSummary(displayedRecordId, storageDdmsDeleteOutcomes)}
              </pre>
              <CopyTextButton
                text={formatPartialStorageDeleteSummary(displayedRecordId, storageDdmsDeleteOutcomes)}
                label="Copy partial summary"
                testId="button-copy-storage-delete-partial-summary"
              />
            </div>
          )}
          <AlertDialogFooter>
            <Button variant="outline" size="sm" onClick={() => setStorageDeleteConfirmOpen(false)} disabled={Boolean(storageDeleting)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { void runStorageDelete("soft"); }}
              disabled={Boolean(storageDeleting)}
            >
              {storageDeleting === "soft" ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {storageDeleteStep ?? "Soft deleting…"}
                </span>
              ) : (
                deleteLinkedDdms ? "Delete DDMS + soft delete" : "Soft delete"
              )}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { void runStorageDelete("purge"); }}
              disabled={Boolean(storageDeleting)}
            >
              {storageDeleting === "purge" ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {storageDeleteStep ?? "Purging…"}
                </span>
              ) : (
                deleteLinkedDdms ? "Delete DDMS + purge" : "Purge"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={storageDeleteCompletion !== null}
        onOpenChange={(open) => {
          if (!open && storageDeleteCompletion) closeStorageDeleteCompletion();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-600" />
              Storage record deletion complete
            </AlertDialogTitle>
            <AlertDialogDescription>
              {storageDeleteCompletion?.mode === "soft"
                ? "The Storage record was soft deleted."
                : "The Storage record and all of its versions were permanently purged."}
              {storageDeleteCompletion?.recordId && (
                <span className="mt-2 block break-all font-mono text-xs text-foreground">
                  {storageDeleteCompletion.recordId}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {storageDeleteCompletion && (
            <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
              <pre
                className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all text-xs"
                data-testid="storage-delete-completion-summary"
              >
                {formatStorageDeleteSummary(storageDeleteCompletion)}
              </pre>
              <CopyTextButton
                text={formatStorageDeleteSummary(storageDeleteCompletion)}
                label="Copy deletion summary"
                testId="button-copy-storage-delete-summary"
              />
            </div>
          )}
          <AlertDialogFooter>
            <Button size="sm" onClick={closeStorageDeleteCompletion} data-testid="button-close-storage-delete-summary">
              Done
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {grid2dOpen && (
        <div className="absolute inset-0 z-[60] bg-background flex flex-col rounded-lg overflow-hidden border border-border/40">
          <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-4 py-2 shrink-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Mountain className="h-4 w-4 text-sky-500" />
              Grid2d Surface — 3D
              {grid2dSurface?.title && (
                <Badge variant="secondary" className="ml-1 text-xs font-mono font-normal max-w-[280px] truncate">
                  {grid2dSurface.title}
                </Badge>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setGrid2dOpen(false)} aria-label="Close">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </div>

          <div className="flex flex-1 min-h-0 overflow-hidden p-4">
            {grid2dLoading && (
              <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading grid surface…</span>
              </div>
            )}

            {!grid2dLoading && grid2dError && (
             <div className="flex items-start gap-2 self-start rounded-md border border-error-border/60 bg-error-surface px-3 py-2 text-xs text-error-text">
                <span className="min-w-0 flex-1 break-words">{grid2dError}</span>
                <CopyErrorButton error={grid2dError} />
              </div>
            )}

            {!grid2dLoading && !grid2dError && grid2dSurface && (
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">Loading 3D renderer…</span>
                  </div>
                }
              >
                <div className="flex-1 min-h-0">
                  <Grid2dSurfaceView surface={grid2dSurface} />
                </div>
              </Suspense>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type SyncMessage =
  | { type: "viewMode"; value: ViewMode }
  | { type: "query"; value: string }
  | { type: "searchOpen"; value: boolean };

const FS_CONSOLE_DEFAULT = 300;
const FS_CONSOLE_MIN = 80;
const FS_CONSOLE_MAX = 700;

export function JsonViewerToolbar({ json, className, storageKey, title, defaultFullscreen = false, onFullscreenClose, hideStorageLookup, hideSearchLookup, hideDdmsLookup, hideWdmsLookup, rdmsContext, searchRecordId, storageRecordId, onRecordDeleted, openRdmsDeleteRequestId, onRdmsDeleteRequestHandled }: JsonViewerToolbarProps) {
  const [fullscreenOpen, setFullscreenOpen] = useState(defaultFullscreen);
  const [fsConsoleOpen, setFsConsoleOpen] = useState(false);
  const [fsConsoleHeight, setFsConsoleHeight] = useState(FS_CONSOLE_DEFAULT);
  const fsConsoleDragState = useRef<{ startY: number; startHeight: number } | null>(null);
  const [lookupResult, setLookupResult] = useState<JsonViewerLookupResult | null>(null);
  const activeJson = lookupResult?.json ?? json;
  const activeStorageKey = lookupResult?.storageKey ?? storageKey;
  const activeRdmsContext = lookupResult?.rdmsContext ?? rdmsContext;
  const defaultResponseTitle = storageRecordId
    ? RESPONSE_TITLES.search
    : searchRecordId
      ? RESPONSE_TITLES.storage
      : (title ?? "JSON");
  const [displayedTitle, setDisplayedTitle] = useState(defaultResponseTitle);

  useEffect(() => {
    setDisplayedTitle(defaultResponseTitle);
  }, [json, defaultResponseTitle]);

  useEffect(() => {
    setLookupResult(null);
  }, [json]);

  const handleLookupResult = useCallback((result: JsonViewerLookupResult | null) => {
    setLookupResult(result);
    setDisplayedTitle(result ? RESPONSE_TITLES[result.responseType] : defaultResponseTitle);
  }, [defaultResponseTitle]);

  const handleResponseTypeChange = useCallback((type: ResponseType) => {
    setDisplayedTitle(RESPONSE_TITLES[type]);
  }, []);

  const handleFsConsoleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    fsConsoleDragState.current = { startY: e.clientY, startHeight: fsConsoleHeight };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!fsConsoleDragState.current) return;
      const delta = fsConsoleDragState.current.startY - ev.clientY;
      const next = Math.min(FS_CONSOLE_MAX, Math.max(FS_CONSOLE_MIN, fsConsoleDragState.current.startHeight + delta));
      setFsConsoleHeight(next);
    };
    const onUp = () => {
      fsConsoleDragState.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [fsConsoleHeight]);

  const handleFullscreenClose = useCallback(() => {
    setFullscreenOpen(false);
    onFullscreenClose?.();
  }, [onFullscreenClose]);

  const parsedJson: JsonValue | null = useMemo(() => {
    try {
      return JSON.parse(activeJson) as JsonValue;
    } catch {
      return null;
    }
  }, [activeJson]);

  // Shared collapse state — lifted here so inline and fullscreen views stay in sync.
  const sharedTreeState = useTreeCollapsed(parsedJson, activeStorageKey);

  // Shared viewer state — lifted here so inline and fullscreen views stay in sync.
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  // BroadcastChannel sync with the pop-out tab.
  const channelName = storageKey ? `osdu-json-sync-${storageKey}` : null;
  const channelRef = useRef<BroadcastChannel | null>(null);
  // Track the last value received from the channel so we don't echo it back.
  const lastReceivedRef = useRef<{ viewMode: ViewMode | null; query: string | null; searchOpen: boolean | null }>({
    viewMode: null,
    query: null,
    searchOpen: null,
  });

  useEffect(() => {
    if (!channelName) return;
    const ch = new BroadcastChannel(channelName);
    channelRef.current = ch;
    ch.onmessage = (e: MessageEvent<SyncMessage>) => {
      const msg = e.data;
      if (msg.type === "viewMode") { lastReceivedRef.current.viewMode = msg.value; setViewMode(msg.value); }
      if (msg.type === "query") { lastReceivedRef.current.query = msg.value; setQuery(msg.value); }
      if (msg.type === "searchOpen") { lastReceivedRef.current.searchOpen = msg.value; setSearchOpen(msg.value); }
    };
    return () => { ch.close(); channelRef.current = null; };
  }, [channelName]);

  useEffect(() => {
    if (!channelRef.current) return;
    if (lastReceivedRef.current.viewMode === viewMode) { lastReceivedRef.current.viewMode = null; return; }
    channelRef.current.postMessage({ type: "viewMode", value: viewMode } satisfies SyncMessage);
  }, [viewMode]);

  useEffect(() => {
    if (!channelRef.current) return;
    if (lastReceivedRef.current.query === query) { lastReceivedRef.current.query = null; return; }
    channelRef.current.postMessage({ type: "query", value: query } satisfies SyncMessage);
  }, [query]);

  useEffect(() => {
    if (!channelRef.current) return;
    if (lastReceivedRef.current.searchOpen === searchOpen) { lastReceivedRef.current.searchOpen = null; return; }
    channelRef.current.postMessage({ type: "searchOpen", value: searchOpen } satisfies SyncMessage);
  }, [searchOpen]);

  const sharedViewerState: SharedViewerState = {
    viewMode,
    onViewModeChange: setViewMode,
    query,
    onQueryChange: setQuery,
    searchOpen,
    onSearchOpenChange: setSearchOpen,
  };

  const handlePopOut = useCallback(() => {
    const dataKey = `osdu-json-popout-${Date.now()}`;
    localStorage.setItem(dataKey, activeJson);
    trackEvent("json_popout_opened", {
      source: "viewer",
      view_mode: viewMode,
      search_open: searchOpen,
    });
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const params = new URLSearchParams({ data: dataKey });
    if (activeStorageKey) params.set("key", activeStorageKey);
    params.set("label", activeStorageKey ?? "JSON");
    params.set("viewMode", viewMode);
    params.set("query", query);
    params.set("searchOpen", searchOpen ? "1" : "0");
    if (channelName) params.set("channel", channelName);
    window.open(`${base}/json-popout?${params.toString()}`, "_blank");
  }, [activeJson, activeStorageKey, viewMode, query, searchOpen, channelName]);

  return (
    <>
      {!defaultFullscreen && (
        <JsonViewerContent
          key={lookupResult?.label ?? "original"}
          json={activeJson}
          className={className}
          storageKey={activeStorageKey}
          onMaximize={() => setFullscreenOpen(true)}
          onPopOut={handlePopOut}
          sharedTreeState={sharedTreeState}
          sharedViewerState={sharedViewerState}
          hideStorageLookup={hideStorageLookup || Boolean(lookupResult)}
          hideSearchLookup={hideSearchLookup || Boolean(lookupResult)}
          hideDdmsLookup={hideDdmsLookup || Boolean(lookupResult)}
          hideWdmsLookup={hideWdmsLookup || Boolean(lookupResult)}
          rdmsContext={activeRdmsContext}
          searchRecordId={lookupResult ? undefined : searchRecordId}
          storageRecordId={lookupResult ? undefined : storageRecordId}
          lookupResult={lookupResult}
          onLookupResult={handleLookupResult}
          onResponseTypeChange={handleResponseTypeChange}
          onRecordDeleted={onRecordDeleted}
          openRdmsDeleteRequestId={openRdmsDeleteRequestId}
          onRdmsDeleteRequestHandled={onRdmsDeleteRequestHandled}
        />
      )}

      <Dialog open={fullscreenOpen} onOpenChange={(open) => { if (!open) handleFullscreenClose(); }}>
        <DialogContent
          className="max-w-none w-screen h-screen flex flex-col p-0 gap-0 rounded-none border-0 [&>button]:h-7 [&>button]:w-7 [&>button]:rounded-md [&>button]:border [&>button]:border-border/60 [&>button]:bg-background/60 [&>button]:p-1 [&>button]:opacity-100 [&>button]:hover:bg-accent"
          aria-describedby={undefined}
          onKeyDown={(e) => {
            if (e.key === "Escape") handleFullscreenClose();
          }}
        >
          <DialogTitle className="sr-only">{displayedTitle}</DialogTitle>
          <div className="flex items-center border-b border-border/40 bg-muted/20 px-4 py-2 shrink-0">
            <span className="text-sm font-medium text-foreground">{displayedTitle}</span>
          </div>
          <div className="flex-1 overflow-hidden min-h-0 p-4">
            <JsonViewerContent
              key={lookupResult?.label ?? "original"}
              json={activeJson}
              storageKey={activeStorageKey}
              _isFullscreen
              className="h-full"
              sharedTreeState={sharedTreeState}
              sharedViewerState={sharedViewerState}
              hideStorageLookup={hideStorageLookup || Boolean(lookupResult)}
              hideSearchLookup={hideSearchLookup || Boolean(lookupResult)}
              hideDdmsLookup={hideDdmsLookup || Boolean(lookupResult)}
              hideWdmsLookup={hideWdmsLookup || Boolean(lookupResult)}
              rdmsContext={activeRdmsContext}
              searchRecordId={lookupResult ? undefined : searchRecordId}
              storageRecordId={lookupResult ? undefined : storageRecordId}
              lookupResult={lookupResult}
              onLookupResult={handleLookupResult}
              onResponseTypeChange={handleResponseTypeChange}
              onRecordDeleted={onRecordDeleted}
              openRdmsDeleteRequestId={openRdmsDeleteRequestId}
              onRdmsDeleteRequestHandled={onRdmsDeleteRequestHandled}
            />
          </div>
          {fsConsoleOpen && (
            <>
              <div
                className="shrink-0 h-[5px] cursor-ns-resize bg-border/60 hover:bg-primary/40 active:bg-primary/60 transition-colors"
                onMouseDown={handleFsConsoleDragStart}
                title="Drag to resize"
              />
              <div className="shrink-0" style={{ height: fsConsoleHeight }}>
                <ConsolePanel height={fsConsoleHeight} />
              </div>
            </>
          )}
          <div
            className="shrink-0 h-7 flex items-center gap-2 px-3 border-t border-border bg-card/80 cursor-pointer select-none hover:bg-muted/60 transition-colors"
            onClick={() => setFsConsoleOpen((v) => !v)}
            role="button"
            aria-expanded={fsConsoleOpen}
            aria-label="Toggle console"
          >
            <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] font-medium text-muted-foreground">Console</span>
            <div className="ml-auto text-muted-foreground">
              {fsConsoleOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
