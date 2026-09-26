=> { rdmsContext ? void handleRdmsLookup() : void handleSearchLookup(); }}
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

export function JsonViewerToolbar({ json, className, storageKey, title, defaultFullscreen = false, onFullscreenClose, hideStorageLookup, hideSearchLookup, hideDdmsLookup, hideWdmsLookup, rdmsContext, searchRecordId, storageRecordId, onRecordDeleted }: JsonViewerToolbarProps) {
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
