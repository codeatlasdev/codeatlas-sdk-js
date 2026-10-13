import { describe, expect, test } from "bun:test";
import { CodeAtlas, CodeAtlasError } from "../src/index.ts";

const client = new CodeAtlas();

describe("live read API", () => {
  test("health", async () => {
    const health = await client.health();
    expect(health.status).toBe("ok");
    expect(health.service).toBe("codeatlas-api");
  });

  test("services.list paginates with limit and cursor", async () => {
    const first = await client.services.list({ limit: 1 });
    expect(first.data).toHaveLength(1);
    expect(first.count).toBeGreaterThanOrEqual(first.data.length);
    expect(first.next_cursor).not.toBeNull();
    const second = await client.services.list({
      limit: 1,
      cursor: first.next_cursor as string,
    });
    expect(second.data[0]?.slug).not.toBe(first.data[0]?.slug);
  });

  test("services.iterate yields the whole catalog", async () => {
    const all: string[] = [];
    for await (const service of client.services.iterate({ limit: 1 })) {
      all.push(service.slug);
    }
    const page = await client.services.list({ limit: 100 });
    expect(all).toEqual(page.data.map((s) => s.slug));
  });

  test("services.get returns one service", async () => {
    const { data } = await client.services.list({ limit: 1 });
    const slug = data[0]?.slug as string;
    const service = await client.services.get(slug);
    expect(service.slug).toBe(slug);
    expect(service.capabilities.length).toBeGreaterThan(0);
  });

  test("services.get throws CodeAtlasError for unknown slug", async () => {
    const error = await client.services.get("does-not-exist").catch((e) => e);
    expect(error).toBeInstanceOf(CodeAtlasError);
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
    expect(error.hint).not.toBe("");
  });

  test("services.search filters client-side", async () => {
    const hits = await client.services.search("whatsapp");
    expect(hits.length).toBeGreaterThan(0);
    expect(await client.services.search("zzz-no-match-zzz")).toEqual([]);
  });
});
