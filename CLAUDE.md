# wt61-driver

Reads a WitMotion WT61 IMU over serial and serves it as NDJSON over TCP to
microservice.hm (`../microservice.hm`, its IMU with `HOUR_METER_IMU_SOURCE=wit`).

- The wire is a contract:
  `../FMS-Backend/docs/ecosystem/integrations/wt61-driver-to-hm.md`. Only
  `src/modules/protocol.ts` writes lines. It is pinned by
  `tests/fixtures/wt61-stream-v1.{bin,ndjson}`; microservice.hm keeps a
  byte-identical copy of the `.ndjson` (`deno task wt61:verify` there). A wire
  change = `protocol.ts` + `bun run fixture` + the contract doc + the copy in
  microservice.hm + its parser, together. Adding a field is fine; renaming,
  removing or re-meaning one bumps `PROTOCOL_VERSION`.
- Never use the module's roll/pitch to remove gravity (they follow the
  accelerometer); yaw drifts (no magnetometer). Scales and packet layout:
  WT61 spec V1.0 §7, summarised in README.md.
- `bun test` must stay hermetic: no serial device, only 127.0.0.1.

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun check` instead of `tsc --noEmit`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Type checking

Use `bun check` to type check the project. It reads `tsconfig.json` and reports the same errors as `tsc`.

- `bun check src/index.ts` checks one file and what it imports
- `bun --check src/index.ts`, `bun test --check` and `bun build --check` type check first, and do nothing else if there is an error

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
