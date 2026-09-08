_SIZE = 20;

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

  const displayJson = overlayJson ?? json;

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
  const ddmsTarget = useMemo(() => {
    const target = parsedJson ? findReservoirDdmsTarget(parsedJson) : null;
    if (!target) return null;
    return {
      ...target,
      datatype: target.datatype ?? findFirstStringField(parsedJson, "$type"),
      uuid: target.uuid ?? findFirstStringField(parsedJson, "uuid"),
    };
  }, [parsedJson]);

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
    while (idx < lower.length) {
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
      setTimeout(() => setCopied(false), 2000);
    });
  }, [json]);

  const toggleSearch = useCallback(() => {
    setSearchOpen(!searchOpen);
  }, [searchOpen, setSearchOpen]);

  const closeAndClearSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, [setSearchOpen, setQuery]);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
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
  }, []);

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

  const openRecordInPopout = useCallback((recordJson: string, label: string) => {
    const dataKey = `osdu-json-popout-${Date.now()}`;
    localStorage.setItem(dataKey, recordJson);
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
    try {
      const res = await fetch(`/api/osdu/records/${encodeURIComponent(lookupId)}`);
      if (res.status === 404) { setLookupError("Record not found"); return; }
      if (!res.ok) { setLookupError("Failed to fetch record"); return; }
      const data: unknown = await res.json();
      setOverlayJson(JSON.stringify(data, null, 2));
      setOverlayLabel(lookupId);
      onResponseTypeChange?.("storage");
    } catch {
      setLookupError("Failed to fetch record");
    } finally {
      setLookupLoading(null);
    }
  }, [selectedText, displayedRecordId, lookupLoading, onResponseTypeChange]);

  const handleSearchLookup = useCallback(async () => {
    const selectedSearchId = extractFirstOsduId(selectedText);
    const lookupId = selectedSearchId || displayedRecordId || selectedText.trim();
    if (!lookupId || lookupLoading) return;
    setLookupLoading("search");
    setLookupError(null);
    try {
      const res = await fetch("/api/osdu/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "*:*:*:*", query: `id:"${lookupId}"`, limit: 1 }),
      });
      if (!res.ok) { setLookupError("Search failed"); return; }
      const data = await res.json() as { results: unknown[]; totalCount: number };
      if (data.totalCount === 0 || data.results.length === 0) { setLookupError("No results found"); return; }
      setOverlayJson(JSON.stringify(data.results[0], null, 2));
      setOverlayLabel(lookupId);
      onResponseTypeChange?.("search");
    } catch {
      setLookupError("Search failed");
    } finally {
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
    try {
      const url = `/api/osdu/rdms/dataspaces/${encodeURIComponent(ddmsTarget.dataspace)}/resources/${encodeURIComponent(ddmsTarget.datatype)}/${encodeURIComponent(ddmsTarget.uuid)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setLookupError(err.error ?? "Failed to fetch Reservoir DDMS record");
        return;
      }
      const data: unknown = await res.json();
      setOverlayJson(JSON.stringify(data, null, 2));
      setOverlayLabel(ddmsTarget.uuid);
      onResponseTypeChange?.("ddms");
    } catch {
      setLookupError("Failed to fetch Reservoir DDMS record");
    } finally {
      setLookupLoading(null);
    }
  }, [ddmsTarget, lookupLoading, onResponseTypeChange]);

  const handleBackToOriginal = useCallback(() => {
    setOverlayJson(null);
    setOverlayLabel(null);
    if (originalResponseType) onResponseTypeChange?.(originalResponseType);
  }, [originalResponseType, onResponseTypeChange]);

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
    try {
      const res = await fetch("/api/osdu/wdms/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urns: wdmsUrns }),
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
    } catch {
      setWdmsError("Failed to connect to WDMS");
      setWdmsOpen(true);
    } finally {
      setWdmsLoading(false);
    }
  }, [selectedUrns, wdmsLoading]);

  // RDMS lookup: detect UUID in selectedText, resolve $type from JSON context
  const selectedUuid = useMemo(() => {
    if (!rdmsContext || !_isFullscreen) return null;
    const t = selectedText.trim();
    return UUID_RE.test(t) ? t : null;
  }, [rdmsContext, _isFullscreen, selectedText]);

  const rdmsDatatype = useMemo(() => {
    if (!selectedUuid || !parsedJson) return null;
    return findObjectTypeForUuid(parsedJson, selectedUuid);
  }, [selectedUuid, parsedJson]);

  // RDMS array-data: detect entity type and UUID from the root of the original record
  const parsedOriginalJson: JsonValue | null = useMemo(() => {
    try { return JSON.parse(json) as JsonValue; } catch { return null; }
  }, [json]);
  const rdmsArrayType = useMemo((): RdmsArrayType | null => {
    if (!rdmsContext) return null;
    // Prefer the datatype passed directly via rdmsContext (set from the resource selection),
    // fall back to parsing $type from the JSON root.
    const candidate = rdmsContext.datatype ?? getRootField<string>(parsedOriginalJson, "$type");
    if (typeof candidate === "string" && (RDMS_ARRAY_TYPES as readonly string[]).includes(candidate)) {
      return candidate as RdmsArrayType;
    }
    return null;
  }, [rdmsContext, parsedOriginalJson]);
  const rdmsRootUuid = useMemo(
    () => rdmsContext?.uuid ?? getRootUuid(parsedOriginalJson),
    [rdmsContext, parsedOriginalJson],
  );

  const handleRdmsLookup = useCallback(async () => {
    if (!selectedUuid || !rdmsContext || lookupLoading) return;
    setLookupLoading("search");
    setLookupError(null);
    const datatype = rdmsDatatype ?? "";
    try {
      const url = `/api/osdu/rdms/dataspaces/${encodeURIComponent(rdmsContext.dataspace)}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(selectedUuid)}`;
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
  }, [selectedUuid, rdmsContext, rdmsDatatype, lookupLoading]);

  const handleArrayData = useCallback(async () => {
    if (!rdmsContext || !parsedOriginalJson || !rdmsArrayType || !rdmsRootUuid) return;
    setArrayOpen(true);
    setArrayLoading(true);
    setArrayError(null);
    setArrayResults([]);

    const ds = encodeURIComponent(rdmsContext.dataspace);
    const dt = encodeURIComponent(rdmsArrayType);
    const uid = encodeURIComponent(rdmsRootUuid);
    const base = `/api/osdu/rdms/dataspaces/${ds}/resources/${dt}/${uid}/arrays`;

    async function fetchArrayPath(hdfPath: string): Promise<ArrayDataResult> {
      const res = await fetch(`${base}?path=${encodeURIComponent(hdfPath)}`);
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
      console.log("[ArrayData] Full JSON:", parsedOriginalJson);

      // The API may return an array of records; always use the first element.
      const root: JsonValue = Array.isArray(parsedOriginalJson)
        ? (parsedOriginalJson as JsonValue[])[0] ?? null
        : parsedOriginalJson;

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
    } catch {
      setArrayError("Failed to fetch array data");
    } finally {
      setArrayLoading(false);
    }
  }, [rdmsContext, parsedOriginalJson, rdmsArrayType, rdmsRootUuid]);

  const rawSegments = buildRawSegments(displayJson, rawMatches, activeIndex);
  let rawSegmentMatchIndex = -1;
  const lineWrapDisabled = viewMode !== "raw";
  const decreaseFontDisabled = viewMode !== "raw" || fontSize <= MIN_FONT_SIZE;
  const increaseFontDisabled = viewMode !== "raw" || fontSize >= MAX_FONT_SIZE;
  const selectedStorageId = extractFirstOsduId(selectedText);
  const selectedSearchId = extractFirstOsduId(selectedText);
  const hasRecordResponse = Boolean(displayedRecordId);
  const storageLookupDisabled = hasRecordResponse ? !!lookupLoading : !selectedText || !!lookupLoading;
  const searchLookupDisabled = rdmsContext
    ? !selectedUuid || !!lookupLoading
    : hasRecordResponse ? !!lookupLoading : !selectedText || !!lookupLoading;
  const ddmsLookupDisabled = !ddmsTarget || !!lookupLoading;
  const wdmsLookupDisabled = wdmsUrns.length === 0 || !!wdmsLoading;
  const arrayDataDisabled = !!arrayLoading;
  const matchNavigationDisabled = totalMatches === 0;

  return (
    <div ref={containerRef} className={cn("relative flex flex-col gap-1", _isFullscreen && "h-full", className)} onClick={handleContainerClick}>
      {_isFullscreen && lookupError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive animate-in fade-in slide-in-from-top-1 duration-150">
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
            {overlayJson && (
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
                {overlayLabel && (
                  <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                    {overlayLabel}
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

            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex"
                  tabIndex={searchLookupDisabled ? 0 : undefined}
                  aria-label={searchLookupDisabled ? (rdmsContext ? "Reservoir DDMS lookup unavailable until a UUID is selected" : "Search unavailable until a record ID is available") : undefined}
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

            {rdmsContext && rdmsArrayType && (
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
            storageKey={overlayJson ? (overlayLabel ?? undefined) : storageKey}
            treeMatches={searchOpen ? treeMatches : []}
            activeMatchIndex={searchOpen ? activeIndex : -1}
            onActiveRef={handleActiveTreeRef}
            onMatchClick={searchOpen ? setActiveIndex : undefined}
            sharedState={overlayJson ? undefined : sharedTreeState}
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
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
                      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {arrayError}
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

export function JsonViewerToolbar({ json, className, storageKey, title, defaultFullscreen = false, onFullscreenClose, hideStorageLookup, hideWdmsLookup, rdmsContext, searchRecordId, storageRecordId }: JsonViewerToolbarProps) {
  const [fullscreenOpen, setFullscreenOpen] = useState(defaultFullscreen);
  const [fsConsoleOpen, setFsConsoleOpen] = useState(false);
  const [fsConsoleHeight, setFsConsoleHeight] = useState(FS_CONSOLE_DEFAULT);
  const fsConsoleDragState = useRef<{ startY: number; startHeight: number } | null>(null);
  const defaultResponseTitle = storageRecordId
    ? RESPONSE_TITLES.search
    : searchRecordId
      ? RESPONSE_TITLES.storage
      : (title ?? "JSON");
  const [displayedTitle, setDisplayedTitle] = useState(defaultResponseTitle);

  useEffect(() => {
    setDisplayedTitle(defaultResponseTitle);
  }, [json, defaultResponseTitle]);

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

  const parsedJson: JsonValue | null = (() => {
    try {
      return JSON.parse(json) as JsonValue;
    } catch {
      return null;
    }
  })();

  // Shared collapse state — lifted here so inline and fullscreen views stay in sync.
  const sharedTreeState = useTreeCollapsed(parsedJson, storageKey);

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
    localStorage.setItem(dataKey, json);
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const params = new URLSearchParams({ data: dataKey });
    if (storageKey) params.set("key", storageKey);
    params.set("label", storageKey ?? "JSON");
    params.set("viewMode", viewMode);
    params.set("query", query);
    params.set("searchOpen", searchOpen ? "1" : "0");
    if (channelName) params.set("channel", channelName);
    window.open(`${base}/json-popout?${params.toString()}`, "_blank");
  }, [json, storageKey, viewMode, query, searchOpen, channelName]);

  return (
    <>
      {!defaultFullscreen && (
        <JsonViewerContent
          json={json}
          className={className}
          storageKey={storageKey}
          onMaximize={() => setFullscreenOpen(true)}
          onPopOut={handlePopOut}
          sharedTreeState={sharedTreeState}
          sharedViewerState={sharedViewerState}
          hideStorageLookup={hideStorageLookup}
          hideWdmsLookup={hideWdmsLookup}
          rdmsContext={rdmsContext}
          searchRecordId={searchRecordId}
          storageRecordId={storageRecordId}
          onResponseTypeChange={handleResponseTypeChange}
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
              json={json}
              storageKey={storageKey}
              _isFullscreen
              className="h-full"
              sharedTreeState={sharedTreeState}
              sharedViewerState={sharedViewerState}
              hideStorageLookup={hideStorageLookup}
              hideWdmsLookup={hideWdmsLookup}
              rdmsContext={rdmsContext}
              searchRecordId={searchRecordId}
              storageRecordId={storageRecordId}
              onResponseTypeChange={handleResponseTypeChange}
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
