# Grid2d visualization change review

This note records the issues and validation gaps found while reviewing the
previous Grid2d surface visualization check-in from another coding agent
(`787d0ec9d013ae2ea338c50a4ffeb9ac42a94535`). It is intended as a checklist
for future changes in this area.

## Issues found

### 1. The dependency manifest was changed without the lockfile

The check-in added `three`, `@types/three`, and `@react-three/fiber` to the
OSDU Explorer package, but did not update the workspace `pnpm-lock.yaml`.
That leaves local development looking complete while a clean or frozen
install can fail or produce a different dependency tree.

**Avoid it:**

- Treat `package.json` and `pnpm-lock.yaml` as one change.
- Install from the workspace filter, not the workspace root:
  `pnpm install --filter @workspace/osdu-explorer`.
- Confirm the artifact importer contains the new packages and versions.
- Run `pnpm install --frozen-lockfile` or the repository's post-merge install
  before considering the change reproducible.

### 2. The feature had pure checks but no complete browser flow

The check-in included an 11-case mesh/colormap harness, which validates
geometry math, null holes, lattice coordinates, fallback coordinates,
vertical exaggeration, and color mapping. It did not exercise the full user
path: identifying a Grid2d record, requesting its Z array, opening the
overlay, loading the lazy renderer, and handling a browser without WebGL.

**Avoid it:**

- Keep pure mesh and colormap checks because they run quickly and do not need
  a browser.
- Add a mocked browser check for the toolbar button, encoded Reservoir DDMS
  array request, loading/error states, overlay, legend, lazy chunk, and
  WebGL fallback.
- Do not treat the existing dashboard browser check as proof that 3D
  visualization works; it covers a different flow.

### 3. Live validation could not prove the Grid2d interaction

The preview loaded successfully and showed the updated release metadata, but
without a configured OSDU connection it only verified the connection screen.
It could not prove that a real Grid2d record and Reservoir DDMS response render
correctly.

**Avoid it:**

- Separate “preview starts” from “Grid2d flow works” in release notes.
- Use deterministic mocked data for repeatable browser coverage.
- If real credentials are used for a manual check, never commit Postman
  environments, client secrets, tokens, or other credential-bearing files.

### 4. Large and environment-dependent renderer behavior needs an explicit
boundary

The build passed, but the 3D renderer is a large lazy chunk and the runtime
depends on WebGL. In some browser or preview environments WebGL is unavailable.

**Avoid it:**

- Preserve the dynamic import so Three.js stays out of the normal JSON viewer
  load path.
- Keep the no-WebGL message actionable and leave the table view available.
- Review bundle-size warnings after renderer changes; do not hide them by
  raising the warning threshold without a reason.
- Dispose geometries, controls, and other Three.js resources when the view is
  replaced or unmounted.

## Data-shape pitfalls

### RESQML and Reservoir DDMS are not interchangeable shapes

The record supplies metadata and an HDF path, while the array endpoint supplies
the Z values and may supply dimensions separately. The implementation must
reconcile both sources instead of assuming the record always contains a
complete numeric array.

Check all of the following:

- Read the Z path defensively and report which path segment is missing.
- Encode dataspace, type, root UUID, and array path in the request URL.
- Interpret RDDMS dimensions consistently with the node order. The current
  convention is `[nj, ni]` for `[slowest, fastest]`.
- Treat non-finite values and RESQML/HDF null sentinels as holes, not
  elevations.
- Use supporting-geometry lattice coordinates when available.
- Fall back to index-space coordinates when lattice metadata is absent.
- Reject dimensions or value counts that cannot form a valid surface.

## Safe structure for future changes

1. Keep mesh construction and colormap code free of React, DOM, and Three.js
   imports. This keeps the math testable and preserves lazy loading.
2. Keep the toolbar responsible for record parsing, request cancellation, and
   user-facing errors; keep the renderer responsible for the canvas only.
3. Abort in-flight requests when the viewer unmounts or the record changes.
4. Make loading, malformed data, HTTP failure, and no-WebGL states distinct.
5. Test null-heavy grids, row-major ordering, missing lattice metadata,
   mismatched dimensions, flat/degenerate elevation ranges, and sentinel
   values.
6. Run the complete validation set after dependency or build changes:

   ```text
   pnpm --filter @workspace/osdu-explorer run check:grid2d-mesh
   pnpm --filter @workspace/osdu-explorer run typecheck
   pnpm --filter @workspace/osdu-explorer run build
   pnpm run check:dashboard-kind-filter-browser
   ```

7. Restart the OSDU Explorer workflow after package, lockfile, toolchain, or
   run-command changes, then inspect workflow and browser-console logs.
8. Confirm the displayed application patch version is incremented for every
   user-facing update. The publish date is injected by `vite.config.ts` at
   build time, so a fresh build is required to refresh it.

## Release checklist

- [ ] Package manifest and lockfile agree.
- [ ] No secret-bearing files or unrelated untracked assets are included.
- [ ] Pure Grid2d checks pass.
- [ ] Typecheck passes.
- [ ] Production build passes.
- [ ] Existing browser regressions pass.
- [ ] Mocked Grid2d browser coverage exists or the missing coverage is
      explicitly recorded as a follow-up.
- [ ] Preview starts cleanly and the no-WebGL fallback is available.
- [ ] Version and generated publish metadata are current.