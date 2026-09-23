---
name: Open ETP client availability
description: Constraints around safely enabling the upstream OSDU Open ETP Client.
---

Treat the Open ETP Client as an optional server-side runtime capability and keep REST as the reliable default. Do not assume `@osdu/open-etp-client` can be installed from npm or an OSDU package registry. Direct browser ETP is not viable against the current ADME gateway because authentication is required on the WebSocket upgrade.

**Why:** The upstream project documents that it has no npm repository and must be built manually. Earlier source releases had incompatible runtime and dependency constraints. A live spike confirmed that ADME supports Protocol 9 full arrays and `GetDataSubarrays`, but browser-native sockets cannot attach the required authorization and partition headers. REST base64 substantially narrows the full-array efficiency gap.

**How to apply:** Expose ETP only after a maintained server-side client is installed, loadable, and verified live. Reconsider implementation when a confirmed large-grid workflow requires slab reads that REST cannot serve; otherwise retain REST.