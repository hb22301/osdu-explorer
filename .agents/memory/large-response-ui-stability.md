---
name: Large-response UI stability
description: Stability guidance for diagnostic polling and large JSON viewers in OSDU Explorer.
---

Diagnostic response bodies must be bounded before they enter the in-memory console store, and large collapsed JSON branches should not allocate child-entry arrays until expanded.

**Why:** Frequent polling and repeated React rendering can retain or re-serialize large response objects many times, causing browser freezes even when the store has a finite entry count.

**How to apply:** When adding console capture, polling, or JSON-viewer features, cap retained payload size, avoid rendering more history than the UI needs, pause background polling, and throttle DOM observers or abort in-flight work during unmount.