import { env } from "@/config/env";
import type { TokenStore } from "./secure-store";

/**
 * Thin bearer-authenticated HTTP client for the AJN platform.
 *
 * This mirrors the reuse contract already baked into the web platform's
 * `lib/api-client-react/custom-fetch.ts` (base URL + `Authorization: Bearer`
 * token getter). The server's `adminToken(req)` accepts that bearer token for
 * every `/staff/*` endpoint, so the mobile app authenticates with zero backend
 * changes — it is a native front-end over the existing API, not a new system.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Session invalid/expired — the auth layer should force re-login. */
  get isUnauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface HttpClient {
  get<T>(path: string, query?: QueryParams): Promise<T>;
  post<T>(path: string, jsonBody?: unknown): Promise<T>;
}

type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface HttpClientDeps {
  baseUrl?: string;
  tokens: TokenStore;
  /** Invoked when any request returns 401/403, so the app can sign the user out. */
  onUnauthorized?: () => void;
}

function buildUrl(baseUrl: string, path: string, query?: QueryParams): string {
  // Built by hand rather than via `new URL()` — React Native's Hermes engine
  // does not ship a spec-complete URL/searchParams implementation.
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  let url = `${base}${suffix}`;
  if (query) {
    const pairs: string[] = [];
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    if (pairs.length) url += (url.includes("?") ? "&" : "?") + pairs.join("&");
  }
  return url;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Extract an Arabic error message from the platform's error envelope. */
function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    if (typeof rec.error === "string") return rec.error;
    if (typeof rec.message === "string") return rec.message;
  }
  return fallback;
}

export function createHttpClient(deps: HttpClientDeps): HttpClient {
  const baseUrl = (deps.baseUrl ?? env.apiBaseUrl).replace(/\/+$/, "");

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { query?: QueryParams; jsonBody?: unknown } = {},
  ): Promise<T> {
    const token = await deps.tokens.get();
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.jsonBody !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(buildUrl(baseUrl, path, opts.query), {
        method,
        headers,
        body: opts.jsonBody !== undefined ? JSON.stringify(opts.jsonBody) : undefined,
      });
    } catch (cause) {
      // Network-level failure (offline, DNS, TLS). Surface as a 0-status ApiError
      // so callers/offline logic can distinguish it from HTTP errors.
      throw new ApiError(0, "تعذّر الاتصال بالخادم", cause);
    }

    const body = await parseBody(res);
    if (!res.ok) {
      const err = new ApiError(res.status, messageFromBody(body, `HTTP ${res.status}`), body);
      if (err.isUnauthorized) deps.onUnauthorized?.();
      throw err;
    }
    return body as T;
  }

  return {
    get: (path, query) => request("GET", path, { query }),
    post: (path, jsonBody) => request("POST", path, { jsonBody }),
  };
}
