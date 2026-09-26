---
name: GitHub sync constraints
description: Repository-specific constraints discovered while synchronizing the workspace to GitHub.
---

GitHub secret scanning rejects the imported Postman environment attachment, so it must not be synchronized to the repository unless the sensitive values are removed first. Git Data API blob uploads through the Replit connector should be paced rather than sent as a large parallel burst.

**Why:** The repository rules blocked the environment file as containing a secret, and the connector returned rate-limit responses for a concurrent upload burst.

**How to apply:** Exclude credential-bearing environment exports from future syncs and use sequential or low-concurrency blob creation before assembling the atomic tree/commit.

The GitHub connector can pull remote file contents without advancing the workspace's local Git ref. Verify remote branch and blob SHAs after a pull before creating a commit, or an already-upstream change may be duplicated.

**Why:** The workspace checkout remained on an older local commit after the remote Grid2d update was applied, even though the working files matched GitHub's current tree.

**How to apply:** Treat connector pulls and local Git history synchronization as separate operations; push only source edits that are not already present on the verified remote branch.

When comparing `git ls-tree` output returned through the sandbox shell callback with a GitHub tree, use a printable delimiter such as `%x7c` rather than a tab and strip trailing carriage returns before comparing paths.

**Why:** Tab formatting and CRLF output produced false file-path differences during a workspace-to-GitHub comparison.

**How to apply:** Format local entries as `%(objectname)%x7c%(path)`, split on the delimiter, normalize `\r`, then compare blob SHAs against the remote tree before creating a commit.

When the workspace history diverges from GitHub, build the update on GitHub's current tree and include only the verified files intended for the push; never replace the remote tree with the whole local tree.

**Why:** The workspace contained local-only assets, including a secret-scanned environment export, while GitHub's `main` had commits absent from the local history.

**How to apply:** Confirm the remote ref and target-file base blobs, create a commit on the remote branch without force, and verify the resulting ref and blob SHAs.

Some workspaces have only Replit-managed remotes and no direct GitHub remote. In that case, use the connected GitHub integration to create the commit against GitHub's current tree and advance its ref without force.

**Why:** A normal `git push` cannot reach GitHub when the configured remotes point only to internal Replit mirrors.

**How to apply:** Inspect `git remote -v` first; when no GitHub remote exists, use the authorized connector, include only the intended file blobs, and verify the branch ref and resulting blob SHAs.

Recheck the branch ref immediately before advancing it, even after building a commit on the verified tree.

**Why:** GitHub `main` advanced during a synchronization attempt after its initial comparison; the stale-ref guard correctly aborted before any remote changes were applied.

**How to apply:** If the ref no longer matches the commit used as the new commit's parent, stop and rebuild the update from the latest remote tree rather than retrying the stale ref update.