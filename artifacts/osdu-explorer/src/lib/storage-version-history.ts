// Storage record version history management. Fetches available versions
// and handles version selection for displaying historical JSON states.

export interface StorageVersion {
  version: number;
  isLatest: boolean;
}

// Parse the versions array returned by the API into a friendly format.
export function parseVersions(versionNumbers: number[] | undefined): StorageVersion[] {
  if (!versionNumbers || versionNumbers.length === 0) return [];
  const sorted = [...versionNumbers].sort((a, b) => b - a); // descending
  const latest = sorted[0];
  return sorted.map((v) => ({ version: v, isLatest: v === latest }));
}

// Format a version for display in the UI.
export function formatVersion(version: number, isLatest: boolean): string {
  return isLatest ? `v${version} (latest)` : `v${version}`;
}
