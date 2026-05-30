import { logger } from "./logger";

export interface OsduConfig {
  baseUrl: string;
  partitionId: string;
  token: string;
}

interface FetchOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

export class OsduClient {
  constructor(private config: OsduConfig) {}

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
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

  private headers(): Record<string, string> {
    return {
      "Authorization": `Bearer ${this.config.token}`,
      "Content-Type": "application/json",
      "data-partition-id": this.config.partitionId,
    };
  }

  async fetch(path: string, options: FetchOptions = {}): Promise<{ status: number; data: unknown }> {
    const url = this.buildUrl(path, options.params);
    const method = options.method ?? "GET";

    const init: RequestInit = {
      method,
      headers: this.headers(),
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
