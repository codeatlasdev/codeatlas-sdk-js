export const DEFAULT_BASE_URL = "https://codeatlas.com.br/api/v1";

export interface Service {
  slug: string;
  name: string;
  description: string;
  serviceType: string;
  url: string;
  capabilities: string[];
  deliveryTimeline: string;
}

export interface ServiceList {
  data: Service[];
  /** Total number of services, not the page size. */
  count: number;
  /** Pass as `cursor` to get the next page. null on the last page. */
  next_cursor: string | null;
}

export interface Health {
  status: "ok";
  service: "codeatlas-api";
  version: string;
}

export type ErrorCode =
  | "bad_request"
  | "not_found"
  | "method_not_allowed"
  | "unsupported_media_type";

export interface ListServicesParams {
  /** Page size, 1 to 100. Default 20. */
  limit?: number;
  /** `next_cursor` of the previous page. */
  cursor?: string;
}

export interface ClientOptions {
  baseUrl?: string;
  /** Custom fetch, for tests or runtimes without a global one. */
  fetch?: typeof fetch;
  /** Request timeout in milliseconds. Default 15000. */
  timeoutMs?: number;
}

/** Thrown for every non-2xx response; mirrors the API error envelope. */
export class CodeAtlasError extends Error {
  readonly status: number;
  readonly code: ErrorCode | string;
  readonly hint: string;

  constructor(status: number, code: string, message: string, hint: string) {
    super(message);
    this.name = "CodeAtlasError";
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

export interface ServicesApi {
  list(params?: ListServicesParams): Promise<ServiceList>;
  get(slug: string): Promise<Service>;
  iterate(params?: Omit<ListServicesParams, "cursor">): AsyncGenerator<Service>;
  search(query: string): Promise<Service[]>;
}

export class CodeAtlas {
  readonly baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  readonly services: ServicesApi = {
    /** One page of the service catalog. */
    list: (params: ListServicesParams = {}): Promise<ServiceList> => {
      const query = new URLSearchParams();
      if (params.limit !== undefined) query.set("limit", String(params.limit));
      if (params.cursor !== undefined) query.set("cursor", params.cursor);
      return this.#request<ServiceList>("GET", "/services", query);
    },

    /** One service by slug. Throws CodeAtlasError (not_found) when missing. */
    get: async (slug: string): Promise<Service> => {
      const body = await this.#request<{ data: Service }>(
        "GET",
        `/services/${encodeURIComponent(slug)}`
      );
      return body.data;
    },

    /** Async iterator over every service, following next_cursor. */
    iterate: (params = {}) => this.#iterate(params),

    /**
     * Case-insensitive match on name, slug, description, type and
     * capabilities. The API has no search endpoint: this filters the full
     * catalog on the client.
     */
    search: async (query: string): Promise<Service[]> => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const results: Service[] = [];
      for await (const service of this.services.iterate({ limit: 100 })) {
        const haystack = [
          service.slug,
          service.name,
          service.description,
          service.serviceType,
          ...service.capabilities,
        ]
          .join("\n")
          .toLowerCase();
        if (terms.every((term) => haystack.includes(term))) {
          results.push(service);
        }
      }
      return results;
    },
  };

  async *#iterate(
    params: Omit<ListServicesParams, "cursor">
  ): AsyncGenerator<Service> {
    let cursor: string | undefined;
    do {
      const page: ServiceList = await this.services.list({ ...params, cursor });
      yield* page.data;
      cursor = page.next_cursor ?? undefined;
    } while (cursor !== undefined);
  }

  /** API liveness check. */
  health(): Promise<Health> {
    return this.#request<Health>("GET", "/health");
  }

  async #request<T>(
    method: string,
    path: string,
    query?: URLSearchParams
  ): Promise<T> {
    const qs = query?.toString();
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;
    const response = await this.#fetch(url, {
      method,
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!response.ok) {
      const err = (
        body as
          | { error?: { code?: string; message?: string; hint?: string } }
          | undefined
      )?.error;
      throw new CodeAtlasError(
        response.status,
        err?.code ?? "unknown_error",
        err?.message ?? `HTTP ${response.status}`,
        err?.hint ?? ""
      );
    }
    return body as T;
  }
}
