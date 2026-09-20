---
name: Browser regression checks
description: Environment constraint for running OSDU Explorer UI checks without adding a browser package.
---

The OSDU Explorer workspace includes a system Chromium binary, while the artifact does not currently carry a browser test dependency. Dependency-free browser checks can use Chrome DevTools Protocol through Node's built-in WebSocket support.

**Why:** Adding a browser package is not straightforward in this pnpm workspace because the package-management callback targets the workspace root and rejects workspace filter flags.

**How to apply:** Keep browser checks self-contained and launch the app with explicit `PORT` and `BASE_PATH` values; terminate detached child process groups so the check exits cleanly. Scripts injected with `Page.addScriptToEvaluateOnNewDocument` run as raw JavaScript, so do not put TypeScript annotations inside them.

Performance checks should combine a generous per-action budget with a shorter CDP evaluation timeout so a frozen page fails clearly instead of leaving the harness waiting indefinitely.

**Why:** A large JSON viewer can block both the interaction and the browser protocol response; measuring only the click duration does not distinguish slow work from a hung page.

**How to apply:** Time an action through two animation frames, keep a timeout around the awaited evaluation, and report the action name and elapsed time when either guard fails.

The full browser suite's large-response timing budgets are sensitive to host load, so a focused scenario can pass even when a later performance assertion fails.

**Why:** Shared Chromium runs can briefly exceed interaction budgets without indicating a regression in an unrelated UI path.

**How to apply:** Use the scenario-specific pass point and the reported action name to separate functional failures from suite-wide timing noise.

For responsiveness checks, distinguish browser long-task duration from total time spent waiting for frames to settle.

**Why:** Host scheduling can inflate wall-clock samples without representing sustained JavaScript work, while a genuine UI freeze appears as a long main-thread task.

**How to apply:** Keep a generous evaluation timeout for hung pages, but fail on a clearly sustained long task rather than on every slow frame-delivery sample.