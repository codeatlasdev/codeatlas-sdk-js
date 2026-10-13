# @codeatlas/sdk

Typed TypeScript client and `codeatlas` CLI for the public [CodeAtlas](https://codeatlas.com.br) API.
Read-only, no authentication. API docs: https://codeatlas.com.br/docs · OpenAPI: https://codeatlas.com.br/openapi.json

## Install

```sh
npm install @codeatlas/sdk
```

CLI (standalone binary, no Node needed):

```sh
brew install codeatlasdev/tap/codeatlas
```

or `npx @codeatlas/sdk services list`.

## SDK

```ts
import { CodeAtlas, CodeAtlasError } from "@codeatlas/sdk";

const client = new CodeAtlas(); // baseUrl defaults to https://codeatlas.com.br/api/v1

const page = await client.services.list({ limit: 20 });
console.log(page.count, page.data[0]?.name, page.next_cursor);

for await (const service of client.services.iterate()) console.log(service.slug);

const service = await client.services.get("zelvo-ai");
const hits = await client.services.search("whatsapp"); // client-side filter, the API has no search endpoint

try {
  await client.services.get("nope");
} catch (error) {
  if (error instanceof CodeAtlasError) console.log(error.status, error.code, error.hint);
}
```

### Contact requests (needs OAuth credentials)

```ts
const { clientId, clientSecret } = await CodeAtlas.register("my-agent"); // store the secret, it is shown once
const client = new CodeAtlas({ credentials: { clientId, clientSecret } });

const request = await client.contactRequests.create(
  { name: "Ana Souza", email: "ana@example.com", message: "Quero um diagnóstico do meu atendimento.", service_slug: "zelvo-ai" },
  { idempotencyKey: crypto.randomUUID() }
);
console.log(request.id, request.status); // cr_..., "received"
```

Use `SANDBOX_BASE_URL` as `baseUrl` to validate calls without storing or sending anything.
The SDK fetches and caches the OAuth token (client credentials) for you.

## CLI

```sh
codeatlas services list [--limit N] [--cursor C] [--json]
codeatlas services get <slug> [--json]
codeatlas services search <query> [--json]
codeatlas health
codeatlas register <client-name>
codeatlas contact --name "Ana Souza" --email ana@example.com --message "..." [--sandbox]
```

`register` prints the `CODEATLAS_CLIENT_ID` / `CODEATLAS_CLIENT_SECRET` exports that `contact` reads.

Override the API with `--base-url` or `CODEATLAS_API_URL`.

## Development

```sh
bun install
bun run build
bun test          # hits the live API at codeatlas.com.br
bun run build:binaries
```

Releases: push a tag `vX.Y.Z`. The workflow publishes to npm, attaches CLI binaries to the GitHub release and updates the Homebrew formula.

MIT licensed.
