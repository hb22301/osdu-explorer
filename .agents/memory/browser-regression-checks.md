---
name: Browser regression checks
description: Environment constraint for running OSDU Explorer UI checks without adding a browser package.
---

The OSDU Explorer workspace includes a system Chromium binary, while the artifact does not currently carry a browser test dependency. Dependency-free browser checks can use Chrome DevTools Protocol through Node's built-in WebSocket support.

**Why:** Adding a browser package is not straightforward in this pnpm workspace because the package-management callback targets the workspace root and rejects workspace filter flags.

**How to apply:** Keep browser checks self-contained and launch the app with explicit `PORT` and `BASE_PATH` values; terminate detached child process groups so the check exits cleanly.