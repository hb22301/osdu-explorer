---
name: GitHub sync constraints
description: Repository-specific constraints discovered while synchronizing the workspace to GitHub.
---

GitHub secret scanning rejects the imported Postman environment attachment, so it must not be synchronized to the repository unless the sensitive values are removed first. Git Data API blob uploads through the Replit connector should be paced rather than sent as a large parallel burst.

**Why:** The repository rules blocked the environment file as containing a secret, and the connector returned rate-limit responses for a concurrent upload burst.

**How to apply:** Exclude credential-bearing environment exports from future syncs and use sequential or low-concurrency blob creation before assembling the atomic tree/commit.