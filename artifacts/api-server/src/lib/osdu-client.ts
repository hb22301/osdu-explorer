import { logger } from "./logger";

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

function cacheKey(cfg: OsduConfig): string {
  return `${cfg.tokenEndpoint}|${cfg.clientId}`;
}

async function fetchAccessToken(cfg: OsduConfig): Promise<string> {
  const key = cacheKey(cfg);
  const cached = tokenCache.get(key);

  if (cached && Date.now() < cached.expiresAt) {
    logger.debug("Using cached OSDU access token");
    return cached.accessToken;
  }

  const scope = cfg.scope ?? `${cfg.clientId}/.default`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope,
  });

  logger.info({ tokenEndpoint: cfg.tokenEndpoint, clientId: cfg.clientId }, "Fetching OSDU access token");

  const response = await fetch(cfg.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error({ status: response.status, body: text }, "Failed to fetch OSDU access token");
    throw new Error(`Token fetch failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
    token_type?: string;
  };

  if (!data.access_token) {
    throw new Error("Token response missing access_token field");
  }

  const expiresIn = data.expires_in ?? 3600;
  const expiresAt = Date.now() + (expiresIn - 60) * 1000;
  tokenCache.set(key, { accessToken: data.access_token, expiresAt });

  logger.info({ expiresIn }, "OSDU access token fetched and cached");
  return data.access_token;
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
    const accessToken = await fetchAccessToken(this.config);
    const url = this.buildUrl(path, options.params);
    const method = options.method ?? "GET";

    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "data-partition-id": this.config.partitionId,
      },
    };

    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    logger.info({ method, path }, "OSDU API request");

    const response = await fetch(url, init);
    let data: unknown;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return { status: response.status, data };
  }
}

export function getOsduClient(config: OsduConfig): OsduClient {
  return new OsduClient(config);
}

export function clearTokenCache(cfg: OsduConfig): void {
  tokenCache.delete(cacheKey(cfg));
}
