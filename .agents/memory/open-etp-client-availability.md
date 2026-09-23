---
name: Open ETP client availability
description: Constraints around safely enabling the upstream OSDU Open ETP Client.
---

Treat the Open ETP Client as an optional runtime capability and keep REST as the reliable default. Do not assume `@osdu/open-etp-client` can be installed from npm or an OSDU package registry.

**Why:** The upstream project documents that it has no npm repository and must be built manually. Its available source release targets Node versions below 18, and its locked dependency tree includes packages blocked by current security policy.

**How to apply:** Expose ETP only after the server confirms the client is installed and loadable. If evaluating a newer upstream release, verify Node compatibility, dependency security, package build, and a live ETP session before enabling the control.