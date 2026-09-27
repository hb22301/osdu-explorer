#!/usr/bin/env bash
set -uo pipefail

REMOTE_URL="https://github.com/hb22301/osdu-explorer.git"
REMOTE_REF="refs/remotes/github-sync/main"
POLL_SECONDS="${GITHUB_SYNC_INTERVAL_SECONDS:-300}"
RUN_ONCE="${GITHUB_SYNC_ONCE:-0}"

if [[ ! "$POLL_SECONDS" =~ ^[0-9]+$ ]] || (( POLL_SECONDS < 1 )); then
  printf 'GITHUB_SYNC_INTERVAL_SECONDS must be a positive integer.\n' >&2
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR/.." rev-parse --show-toplevel)" || exit 1
cd "$REPO_ROOT" || exit 1

log() {
  printf '[github-main-sync] %s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

OVERLAPPING_LOCAL_CHANGES=()

find_overlapping_local_changes() {
  local remote_ref="$1"
  local path
  local -A remote_changes=()
  local -A local_changes=()

  while IFS= read -r -d '' path; do
    remote_changes["$path"]=1
  done < <(git diff --name-only -z HEAD "$remote_ref")

  while IFS= read -r -d '' path; do
    local_changes["$path"]=1
  done < <(git diff --name-only -z HEAD)

  while IFS= read -r -d '' path; do
    local_changes["$path"]=1
  done < <(git ls-files --others --exclude-standard -z)

  OVERLAPPING_LOCAL_CHANGES=()
  for path in "${!local_changes[@]}"; do
    if [[ "$path" == "scripts/github-main-sync.sh" ]] && ! git cat-file -e "$remote_ref:$path" 2>/dev/null; then
      continue
    fi
    if [[ -n "${remote_changes[$path]+present}" ]]; then
      OVERLAPPING_LOCAL_CHANGES+=("$path")
    fi
  done
}

poll_once() {
  local branch local_sha remote_sha merge_base
  local merge_output merge_status path
  local -a conflicts=()
  local -a protected_deletions=()

  if ! git fetch --quiet --no-tags --no-write-fetch-head \
    "$REMOTE_URL" "+refs/heads/main:$REMOTE_REF"; then
    log "FETCH_FAILED: could not read GitHub main."
    return 0
  fi

  branch="$(git symbolic-ref --quiet --short HEAD || printf 'detached')"
  if [[ "$branch" != "main" ]]; then
    log "BLOCKED_BRANCH: expected local main, found $branch."
    return 0
  fi

  if git rev-parse --verify --quiet MERGE_HEAD >/dev/null 2>&1; then
    log "BLOCKED_EXISTING_MERGE: finish or abort the current merge before syncing."
    return 0
  fi

  if [[ -d "$(git rev-parse --git-path rebase-merge)" || -d "$(git rev-parse --git-path rebase-apply)" ]]; then
    log "BLOCKED_EXISTING_REBASE: finish or abort the current rebase before syncing."
    return 0
  fi

  local_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse "$REMOTE_REF")"

  if [[ "$local_sha" == "$remote_sha" ]]; then
    log "UP_TO_DATE: local main matches GitHub main at ${remote_sha:0:12}."
    return 0
  fi

  if git merge-base --is-ancestor "$REMOTE_REF" HEAD; then
    log "LOCAL_AHEAD: GitHub main ${remote_sha:0:12} is already included in local main."
    return 0
  fi

  merge_base="$(git merge-base HEAD "$REMOTE_REF" 2>/dev/null || true)"
  if [[ -z "$merge_base" ]]; then
    log "BLOCKED_HISTORY: local main and GitHub main have no common ancestor."
    return 0
  fi

  find_overlapping_local_changes "$REMOTE_REF"
  if (( ${#OVERLAPPING_LOCAL_CHANGES[@]} > 0 )); then
    log "BLOCKED_LOCAL_EDITS: local edits overlap incoming files: ${OVERLAPPING_LOCAL_CHANGES[*]}."
    return 0
  fi

  while IFS= read -r -d '' path; do
    case "$path" in
      .agents/memory/*|attached_assets/*|screenshots/*|scripts/github-main-sync.sh)
        protected_deletions+=("$path")
        ;;
    esac
  done < <(git diff --name-only -z --diff-filter=D HEAD "$REMOTE_REF")

  merge_output="$(git merge-tree --write-tree HEAD "$REMOTE_REF" 2>&1)"
  merge_status=$?
  while IFS= read -r path; do
    [[ "$path" == CONFLICT* ]] && conflicts+=("$path")
  done < <(printf '%s\n' "$merge_output")

  if (( merge_status != 0 )); then
    if (( ${#conflicts[@]} > 0 )); then
      log "BLOCKED_CONFLICT: ${conflicts[*]}."
    else
      log "BLOCKED_MERGE_CHECK: merge preflight failed; no files were changed."
    fi
    if (( ${#protected_deletions[@]} > 0 )); then
      log "BLOCKED_LOCAL_FILES: GitHub would delete ${#protected_deletions[@]} local memory, attachment, or screenshot file(s). Review before syncing."
    fi
    return 0
  fi

  if (( ${#protected_deletions[@]} > 0 )); then
    log "BLOCKED_LOCAL_FILES: GitHub would delete ${#protected_deletions[@]} local memory, attachment, or screenshot file(s). Review before syncing."
    return 0
  fi

  if ! git fetch --quiet --no-tags --no-write-fetch-head \
    "$REMOTE_URL" "+refs/heads/main:$REMOTE_REF"; then
    log "FETCH_FAILED: could not recheck GitHub main before merge."
    return 0
  fi

  if [[ "$(git rev-parse "$REMOTE_REF")" != "$remote_sha" ]]; then
    log "REMOTE_MOVED: GitHub main advanced during preflight; will retry next poll."
    return 0
  fi

  find_overlapping_local_changes "$REMOTE_REF"
  if (( ${#OVERLAPPING_LOCAL_CHANGES[@]} > 0 )); then
    log "BLOCKED_LOCAL_EDITS: local edits now overlap incoming files: ${OVERLAPPING_LOCAL_CHANGES[*]}."
    return 0
  fi

  if git merge --no-edit "$REMOTE_REF"; then
    log "MERGED: GitHub main ${remote_sha:0:12} is now included in local main."
    return 0
  fi

  if git rev-parse --verify --quiet MERGE_HEAD >/dev/null 2>&1; then
    if ! git merge --abort; then
      log "ABORT_FAILED: merge conflicted and Git could not restore the prior workspace; stopping the sync workflow."
      return 1
    fi
  fi

  log "BLOCKED_MERGE: merge failed; no partial merge was kept."
  return 0
}

log "Polling $REMOTE_URL on main every ${POLL_SECONDS}s; incoming conflicts and protected local-file deletions will be reported, not applied."

while true; do
  if ! poll_once; then
    exit 1
  fi

  if [[ "$RUN_ONCE" == "1" ]]; then
    exit 0
  fi

  sleep "$POLL_SECONDS"
done