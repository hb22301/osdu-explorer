import { logger } from "./logger";
import { addEntry, updateEntry } from "./console-store";

export interface OsduConfig {
  baseUrl: string;
  partitionId: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

interface FetchOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

const tokenCache = new Map<string, TokenCacheEntry>();
// Holds in-flight token fetch promises so concurrent callers share one request
const tokenInflight = new Map<string, Promise<string>>();

function cacheKey(cfg: OsduConfig): string {
  return `${cfg.tokenEndpoint}|${cfg.clientId}`;
}

async function fetchAccessToken(cfg: OsduConfig): Promise<string> {
  const key = cacheKey(cfg);
  const cached = tokenCache.get(key);

  if (cached && Date.now() < cached.expiresAt) {
    return cached.accessToken;
  }

  // If another caller is already fetching, piggyback on that promise
  const inflight = tokenInflight.get(key);
  if (inflight) return inflight;

  const scope = cfg.scope ?? `${cfg.clientId}/.default`;

  const promise = (async (): Promise<string> => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope,
    });

    const start = Date.now();
    logger.info({ tokenEndpoint: cfg.tokenEndpoint, clientId: cfg.clientId }, "Fetching OSDU access token");

    let response: Response;
    let responseBody: unknown;
    try {
      response = await fetch(cfg.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      const contentType = response.headers.get("content-type") ?? "";
      responseBody = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addEntry({
        type: "token_fetch",
        level: "error",
        method: "POST",
        url: cfg.tokenEndpoint,
        requestBody: { grant_type: "client_credentials", client_id: cfg.clientId, scope },
        responseStatus: null,
        responseBody: null,
        durationMs: Date.now() - start,
        responseSize: null,
        recordCount: null,
        pending: false,
        message: `Token fetch failed: ${message}`,
      });
      throw new Error(`Token fetch failed: ${message}`);
    }

    const durationMs = Date.now() - start;

    if (!response.ok) {
      addEntry({
        type: "token_fetch",
        level: "error",
        method: "POST",
        url: cfg.tokenEndpoint,
        requestBody: { grant_type: "client_credentials", client_id: cfg.clientId, scope },
        responseStatus: response.status,
        responseBody,
        durationMs,
        responseSize: null,
        recordCount: null,
        pending: false,
        message: `Token fetch failed with status ${response.status}`,
      });
      logger.error({ status: response.status }, "Failed to fetch OSDU access token");
      throw new Error(`Token fetch failed (${response.status})`);
    }

    const data = responseBody as { access_token: string; expires_in?: number; token_type?: string };

    if (!data.access_token) {
      addEntry({
        type: "token_fetch",
        level: "error",
        method: "POST",
        url: cfg.tokenEndpoint,
        requestBody: { grant_type: "client_credentials", client_id: cfg.clientId, scope },
        responseStatus: response.status,
        responseBody,
        durationMs,
        responseSize: null,
        recordCount: null,
        pending: false,
        message: "Token response missing access_token field",
      });
      throw new Error("Token response missing access_token field");
    }

    const expiresIn = data.expires_in ?? 3600;
    const expiresAt = Date.now() + (expiresIn - 60) * 1000;
    tokenCache.set(key, { accessToken: data.access_token, expiresAt });

    addEntry({
      type: "token_fetch",
      level: "info",
      method: "POST",
      url: cfg.tokenEndpoint,
      requestBody: { grant_type: "client_credentials", client_id: cfg.clientId, scope },
      responseStatus: response.status,
      responseBody: { token_type: data.token_type, expires_in: expiresIn },
      durationMs,
      responseSize: null,
      recordCount: null,
      pending: false,
      message: `Access token obtained (expires in ${expiresIn}s)`,
    });

    logger.info({ expiresIn }, "OSDU access token fetched and cached");
    return data.access_token;
  })();

  // Register so concurrent callers share this fetch; clean up when done
  tokenInflight.set(key, promise);
  promise.finally(() => tokenInflight.delete(key));

  return promise;
}

// Known OSDU paginated response array field names
const OSDU_ARRAY_FIELDS = ["results", "schemaInfos", "legalTags", "records", "items"];

function extractRecordCount(data: unknown): number | null {
  if (data == null) return null;
  if (Array.isArray(data)) return data.length;
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const field of OSDU_ARRAY_FIELDS) {
      if (Array.isArray(obj[field])) return (obj[field] as unknown[]).length;
    }
    // Fallback: if there is exactly one top-level array, use its length
    const arrays = Object.values(obj).filter(Array.isArray);
    if (arrays.length === 1) return (arrays[0] as unknown[]).length;
    return 1;
  }
  return 1;
}

export class OsduClient {
  constructor(private config: OsduConfig) {}

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): string {
    const base = this.config.baseUrl.replace(/\/$/, "");
    const url = new URL(`${base}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async fetch(
    path: string,
    options: FetchOptions = {}
  ): Promise<{ status: number; data: unknown }> {
    let accessToken: string;
    try {
      accessToken = await fetchAccessToken(this.config);
    } catch (err) {
      throw err;
    }

    const url = this.buildUrl(path, options.params);
    const method = options.method ?? "GET";

    logger.info({ method, path }, "OSDU API request");

    const start = Date.now();

    // Write the entry immediately so it appears in the console before the response arrives
    const pendingEntry = addEntry({
      type: "api_request",
      level: "info",
      method,
      url,
      requestBody: options.body ?? null,
      responseStatus: null,
      responseBody: null,
      durationMs: null,
      responseSize: null,
      recordCount: null,
      pending: true,
      message: null,
    });

    let response: Response;
    let data: unknown;

    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "data-partition-id": this.config.partitionId,
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });

      const contentType = response.headers.get("content-type") ?? "";
      data = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateEntry(pendingEntry.id, {
        level: "error",
        durationMs: Date.now() - start,
        pending: false,
        message: `Network error: ${message}`,
      });
      throw err;
    }

    const durationMs = Date.now() - start;
    const level = response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info";
    const responseSize = data != null ? Buffer.byteLength(JSON.stringify(data), "utf8") : null;
    const recordCount = extractRecordCount(data);

    updateEntry(pendingEntry.id, {
      level,
      responseStatus: response.status,
      responseBody: data,
      durationMs,
      responseSize,
      recordCount,
      pending: false,
      message: null,
    });

    return { status: response.status, data };
  }
}

export function getOsduClient(config: OsduConfig): OsduClient {
  return new OsduClient(config);
}

export function clearTokenCache(cfg: OsduConfig): void {
  tokenCache.delete(cacheKey(cfg));
}
