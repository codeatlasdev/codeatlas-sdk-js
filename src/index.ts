export const DEFAULT_BASE_URL = "https://codeatlas.com.br/api/v1";
/** Same API with no side effects: writes are validated but nothing is stored or sent. */
export const SANDBOX_BASE_URL = "https://codeatlas.com.br/api/sandbox/v1";
const ORIGIN = "https://codeatlas.com.br";

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
  | "conflict"
  | "forbidden"
  | "invalid_client"
  | "invalid_token"
  | "method_not_allowed"
  | "not_found"
  | "payload_too_large"
  | "rate_limited"
  | "unauthorized"
  | "unprocessable"
  | "unsupported_media_type";

export type ContactLocale = "pt-BR" | "en";

export interface ContactRequestInput {
  /** 2 to 120 characters. */
  name: string;
  email: string;
  /** 10 to 2000 characters. */
  message: string;
  company?: string;
  /** Defaults to pt-BR on the server. */
  locale?: ContactLocale;
  /** One of the slugs returned by services.list. */
  service_slug?: string;
}

export interface ContactRequest {
  id: string;
  status: "received";
  /** "sandbox" when using the sandbox API; "delivered" or "stored" in production. */
  delivery: "delivered" | "stored" | "sandbox";
  created_at: string;
}

export interface BatchResult {
  slug: string | null;
  /** HTTP-style status of this item: 200, 404 or 400. */
  status: number;
  data?: Service;
  error?: { code: string; message: string; hint: string };
}

export type ExportFormat = "jsonl" | "csv" | "md";

export interface ExportJob {
  id: string;
  status: "queued" | "running" | "succeeded";
  format: ExportFormat;
  /** Set when status is "succeeded". */
  download_url: string | null;
  created_at: string;
  /** Jobs and files are kept for 24 hours. */
  expires_at: string;
}

export interface Credentials {
  clientId: string;
  clientSecret: string;
}

export interface RegisteredClient extends Credentials {
  clientName: string;
}

export interface ListServicesParams {
  /** Page size, 1 to 100. Default 20. */
  limit?: number;
  /** `next_cursor` of the previous page. */
  cursor?: string;
}

export interface ClientOptions {
  baseUrl?: string;
  /**
   * OAuth client credentials, needed for write calls (contactRequests.create).
   * Get them with CodeAtlas.register().
   */
  credentials?: Credentials;
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
  /** Up to 50 slugs in one call. Unknown slugs come back as 404 items, not as a thrown error. */
  batch(slugs: string[]): Promise<BatchResult[]>;
}

export interface ExportsApi {
  /** Starts an export job (10 per hour per client). Requires `credentials`. */
  create(format: ExportFormat, options?: { idempotencyKey?: string }): Promise<ExportJob>;
  get(id: string): Promise<ExportJob>;
  /** Polls until the job has succeeded. Rejects after `timeoutMs` (default 60000). */
  wait(id: string, options?: { intervalMs?: number; timeoutMs?: number }): Promise<ExportJob>;
  /** Downloads the file of a succeeded job as text. */
  download(id: string): Promise<string>;
}

export interface ContactRequestsApi {
  /**
   * Sends a contact request to the CodeAtlas team. Requires `credentials`.
   * Pass `idempotencyKey` (8 to 128 printable ASCII characters) to make retries safe.
   */
  create(
    input: ContactRequestInput,
    options?: { idempotencyKey?: string }
  ): Promise<ContactRequest>;
}

export class CodeAtlas {
  readonly baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #credentials: Credentials | undefined;
  #token: { value: string; expiresAt: number } | undefined;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#credentials = options.credentials;
  }

  /**
   * Registers a new OAuth client (RFC 7591) and returns its credentials.
   * The secret is shown once: store it.
   */
  static async register(
    clientName: string,
    options: Pick<ClientOptions, "fetch" | "timeoutMs"> = {}
  ): Promise<RegisteredClient> {
    const body = await new CodeAtlas(options).#send<{
      client_id: string;
      client_secret: string;
      client_name: string;
    }>("POST", `${ORIGIN}/oauth2/register`, {
      body: JSON.stringify({
        client_name: clientName,
        grant_types: ["client_credentials"],
      }),
      headers: { "content-type": "application/json" },
    });
    return {
      clientId: body.client_id,
      clientSecret: body.client_secret,
      clientName: body.client_name,
    };
  }

  readonly contactRequests: ContactRequestsApi = {
    create: async (input, options = {}) => {
      const headers = await this.#authHeaders(options.idempotencyKey);
      const body = await this.#send<{ data: ContactRequest }>(
        "POST",
        `${this.baseUrl}/contact-requests`,
        { body: JSON.stringify(input), headers }
      );
      return body.data;
    },
  };

  readonly exports: ExportsApi = {
    create: async (format, options = {}) => {
      const headers = await this.#authHeaders(options.idempotencyKey);
      const body = await this.#send<{ data: ExportJob }>("POST", `${this.baseUrl}/exports`, {
        body: JSON.stringify({ format }),
        headers,
      });
      return body.data;
    },
    get: async (id) => {
      const body = await this.#send<{ data: ExportJob }>(
        "GET",
        `${this.baseUrl}/exports/${encodeURIComponent(id)}`,
        { headers: await this.#authHeaders() }
      );
      return body.data;
    },
    wait: async (id, options = {}) => {
      const deadline = Date.now() + (options.timeoutMs ?? 60_000);
      for (;;) {
        const job = await this.exports.get(id);
        if (job.status === "succeeded") return job;
        if (Date.now() >= deadline) {
          throw new Error(`Export ${id} is still ${job.status} after the timeout.`);
        }
        await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 1000));
      }
    },
    download: async (id) =>
      this.#fetchText("GET", `${this.baseUrl}/exports/${encodeURIComponent(id)}/download`, {
        headers: await this.#authHeaders(),
        accept: "*/*",
      }),
  };

  async #authHeaders(idempotencyKey?: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${await this.#accessToken()}`,
    };
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    return headers;
  }

  async #accessToken(): Promise<string> {
    if (!this.#credentials) {
      throw new CodeAtlasError(
        401,
        "unauthorized",
        "This call needs OAuth credentials.",
        "Create them with CodeAtlas.register(name) and pass { credentials } to new CodeAtlas()."
      );
    }
    if (this.#token && this.#token.expiresAt > Date.now() + 30_000) {
      return this.#token.value;
    }
    const { clientId, clientSecret } = this.#credentials;
    const token = await this.#send<{ access_token: string; expires_in: number }>(
      "POST",
      `${ORIGIN}/oauth2/token`,
      {
        body: new URLSearchParams({
          grant_type: "client_credentials",
          // The token audience is the API base URL (production or sandbox).
          resource: this.baseUrl,
        }).toString(),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
      }
    );
    this.#token = {
      value: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
    return token.access_token;
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

    batch: async (slugs: string[]): Promise<BatchResult[]> => {
      const body = await this.#send<{ results: BatchResult[] }>(
        "POST",
        `${this.baseUrl}/services/batch`,
        { body: JSON.stringify({ slugs }), headers: { "content-type": "application/json" } }
      );
      return body.results;
    },

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

  #request<T>(method: string, path: string, query?: URLSearchParams): Promise<T> {
    const qs = query?.toString();
    return this.#send<T>(method, `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`);
  }

  /** One request path for everything: returns the raw text, throws CodeAtlasError on non-2xx. */
  async #fetchText(
    method: string,
    url: string,
    init: { body?: string; headers?: Record<string, string>; accept?: string } = {}
  ): Promise<string> {
    const response = await this.#fetch(url, {
      method,
      body: init.body,
      headers: { accept: init.accept ?? "application/json", ...init.headers },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }
      throw toError(response.status, body);
    }
    return text;
  }

  async #send<T>(
    method: string,
    url: string,
    init: { body?: string; headers?: Record<string, string> } = {}
  ): Promise<T> {
    const text = await this.#fetchText(method, url, init);
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/** Understands both the API error envelope and OAuth errors (RFC 6749 / 7591). */
function toError(status: number, body: unknown): CodeAtlasError {
  const b = (body ?? {}) as {
    error?: string | { code?: string; message?: string; hint?: string };
    error_description?: string;
  };
  if (typeof b.error === "string") {
    return new CodeAtlasError(status, b.error, b.error_description ?? b.error, "");
  }
  return new CodeAtlasError(
    status,
    b.error?.code ?? "unknown_error",
    b.error?.message ?? `HTTP ${status}`,
    b.error?.hint ?? ""
  );
}
