import { describe, expect, test } from "bun:test";
import { CodeAtlas, CodeAtlasError } from "../src/index.ts";

/**
 * The write API is exercised against a local server that follows the wire
 * contract of POST /oauth2/register, POST /oauth2/token and
 * POST /api/v1/contact-requests. The read API is tested live in live.test.ts.
 */
function server() {
  const calls: { url: string; headers: Headers; body: string }[] = [];
  let tokens = 0;
  const srv = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = await req.text();
      calls.push({ url: url.pathname, headers: req.headers, body });
      const json = (data: unknown, status = 200) =>
        Response.json(data, { status });
      if (url.pathname === "/oauth2/register") {
        const parsed = JSON.parse(body);
        if (!parsed.client_name) {
          return json({ error: "invalid_client_metadata", error_description: "client_name is required" }, 400);
        }
        return json({ client_id: "ca_1", client_secret: "cas_1", client_name: parsed.client_name }, 201);
      }
      if (url.pathname === "/oauth2/token") {
        const form = new URLSearchParams(body);
        const ok =
          req.headers.get("authorization") === `Basic ${btoa("ca_1:cas_1")}` &&
          form.get("grant_type") === "client_credentials" &&
          req.headers.get("content-type") === "application/x-www-form-urlencoded";
        if (!ok) return json({ error: "invalid_client", error_description: "bad secret" }, 401);
        tokens++;
        return json({ access_token: `tok${tokens}`, expires_in: 3600, scope: "api:write", token_type: "Bearer" });
      }
      if (url.pathname === "/api/v1/contact-requests") {
        if (!req.headers.get("authorization")?.startsWith("Bearer tok")) {
          return json({ error: { code: "unauthorized", message: "no token", hint: "send Bearer" } }, 401);
        }
        if (!JSON.parse(body).email) {
          return json({ error: { code: "bad_request", message: "email", hint: "Use a valid email." } }, 400);
        }
        return json({ data: { id: "cr_1", status: "received", delivery: "stored", created_at: "2026-01-01T00:00:00Z" } }, 201);
      }
      return json({ error: { code: "not_found", message: "x", hint: "y" } }, 404);
    },
  });
  return { srv, calls, origin: `http://127.0.0.1:${srv.port}` };
}

// The SDK sends OAuth calls to the production origin; route them to the local server.
function rewritingFetch(origin: string): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(String(input).replace("https://codeatlas.com.br", origin), init)) as typeof fetch;
}

describe("write API wire contract", () => {
  test("register, then create a contact request with a cached token", async () => {
    const { srv, calls, origin } = server();
    try {
      const f = rewritingFetch(origin);
      const creds = await CodeAtlas.register("my-agent", { fetch: f });
      expect(creds.clientId).toBe("ca_1");
      const client = new CodeAtlas({ credentials: creds, fetch: f });
      const input = { name: "Ana Souza", email: "ana@example.com", message: "Preciso de um diagnóstico." };
      const created = await client.contactRequests.create(input, { idempotencyKey: "key-12345678" });
      await client.contactRequests.create(input);
      expect(created.id).toBe("cr_1");
      expect(created.status).toBe("received");
      expect(calls.filter((c) => c.url === "/oauth2/token")).toHaveLength(1); // token reused
      const post = calls.find((c) => c.url === "/api/v1/contact-requests");
      expect(post?.headers.get("idempotency-key")).toBe("key-12345678");
      expect(new URLSearchParams(calls.find((c) => c.url === "/oauth2/token")?.body).get("resource")).toBe(
        "https://codeatlas.com.br/api/v1"
      );
    } finally {
      srv.stop(true);
    }
  });

  test("create without credentials fails before any request", async () => {
    const client = new CodeAtlas({ fetch: (() => { throw new Error("no network expected"); }) as never });
    const error = await client.contactRequests
      .create({ name: "Ana", email: "a@b.co", message: "mensagem longa ok" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(CodeAtlasError);
    expect(error.code).toBe("unauthorized");
  });

  test("OAuth and API errors both become CodeAtlasError", async () => {
    const { srv, origin } = server();
    try {
      const f = rewritingFetch(origin);
      const bad = new CodeAtlas({ credentials: { clientId: "ca_1", clientSecret: "wrong" }, fetch: f });
      const oauth = await bad.contactRequests
        .create({ name: "Ana", email: "a@b.co", message: "mensagem longa ok" })
        .catch((e) => e);
      expect(oauth.status).toBe(401);
      expect(oauth.code).toBe("invalid_client");

      const ok = new CodeAtlas({ credentials: { clientId: "ca_1", clientSecret: "cas_1" }, fetch: f });
      const api = await ok.contactRequests
        .create({ name: "Ana", email: "", message: "mensagem longa ok" })
        .catch((e) => e);
      expect(api.status).toBe(400);
      expect(api.code).toBe("bad_request");
      expect(api.hint).toBe("Use a valid email.");
    } finally {
      srv.stop(true);
    }
  });
});
