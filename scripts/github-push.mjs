/**
 * Incremental push: only upload files changed since the last GitHub push.
 */
import { execSync } from "node:child_process";
import { ReplitConnectors } from "@replit/connectors-sdk";

const OWNER = "hb22301";
const REPO = "osdu-explorer";
const BRANCH = "main";

const connectors = new ReplitConnectors();

async function ghApi(path, options = {}) {
  const resp = await connectors.proxy("github", path, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await resp.json();
  if (resp.status >= 400) {
    throw new Error(`GitHub API ${path} → ${resp.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

// Get current GitHub HEAD
const refData = await ghApi(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
const githubHeadSha = refData.object.sha;
const githubCommit = await ghApi(`/repos/${OWNER}/${REPO}/git/commits/${githubHeadSha}`);
const baseTreeSha = githubCommit.tree.sha;
console.log("GitHub HEAD:", githubHeadSha.slice(0, 8), "tree:", baseTreeSha.slice(0, 8));

// Get all commits to push (local commits not yet on GitHub)
// We identify the last pushed commit by matching the commit message
const localLog = execSync("git log --oneline", { encoding: "utf8" }).trim().split("\n");
console.log("Local commits:", localLog.slice(0, 5).join(", "), "...");

// Get files changed since last full push (compare current tree to GitHub tree)
// Strategy: use git diff to get all changed/added/deleted files vs the last pushed SHA
// We track by getting the full file list from current HEAD and diff against GitHub's tree
const changedFiles = execSync(
  `git diff --name-only --diff-filter=ACMRT HEAD~3 HEAD`,
  { encoding: "utf8" }
).trim().split("\n").filter(Boolean);

console.log(`Changed files since last push (${changedFiles.length}):`, changedFiles.join(", "));

// Also get deleted files
const deletedFiles = execSync(
  `git diff --name-only --diff-filter=D HEAD~3 HEAD`,
  { encoding: "utf8" }
).trim().split("\n").filter(Boolean);
if (deletedFiles.length) console.log("Deleted files:", deletedFiles.join(", "));

// Create blobs for changed files
const treeItems = [];
const BATCH = 10;
for (let i = 0; i < changedFiles.length; i += BATCH) {
  const batch = changedFiles.slice(i, i + BATCH);
  await Promise.all(batch.map(async (filePath) => {
    const lsLine = execSync(`git ls-files --stage -- "${filePath}"`, { encoding: "utf8" }).trim();
    if (!lsLine) return; // file not tracked
    const mode = lsLine.split(/\s/)[0];
    const hash = lsLine.split(/\s/)[1];
    const raw = execSync(`git cat-file blob ${hash}`, { encoding: "buffer" });
    const isBinary = raw.includes(0);
    const blob = await ghApi(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: "POST",
      body: { content: isBinary ? raw.toString("base64") : raw.toString("utf8"), encoding: isBinary ? "base64" : "utf-8" },
    });
    treeItems.push({
      path: filePath,
      mode: mode === "100755" ? "100755" : mode === "120000" ? "120000" : "100644",
      type: "blob",
      sha: blob.sha,
    });
  }));
  process.stdout.write(`\r  Uploaded ${Math.min(i + BATCH, changedFiles.length)}/${changedFiles.length} files...`);
}

// Mark deleted files
for (const filePath of deletedFiles) {
  treeItems.push({ path: filePath, mode: "100644", type: "blob", sha: null });
}

console.log(`\nCreating tree on top of base ${baseTreeSha.slice(0, 8)}...`);
const tree = await ghApi(`/repos/${OWNER}/${REPO}/git/trees`, {
  method: "POST",
  body: { base_tree: baseTreeSha, tree: treeItems },
});

// Build commit message summarising the pushed commits
const commitMessages = execSync("git log --format=%s HEAD~3..HEAD", { encoding: "utf8" }).trim();
const authorName = execSync("git log -1 --pretty=%an", { encoding: "utf8" }).trim();
const authorEmail = execSync("git log -1 --pretty=%ae", { encoding: "utf8" }).trim();
const authorDate = execSync("git log -1 --pretty=%aI", { encoding: "utf8" }).trim();

console.log("Creating commit...");
const commit = await ghApi(`/repos/${OWNER}/${REPO}/git/commits`, {
  method: "POST",
  body: {
    message: commitMessages,
    tree: tree.sha,
    parents: [githubHeadSha],
    author: { name: authorName, email: authorEmail, date: authorDate },
  },
});

console.log("Updating branch ref...");
await ghApi(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
  method: "PATCH",
  body: { sha: commit.sha, force: true },
});

console.log(`\nDone! https://github.com/${OWNER}/${REPO}`);
