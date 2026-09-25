# Commitverse — agent notes

- The product spec lives at `COMMITVERSE_SPEC.md` (local only, git-ignored). It is the source of truth; formulas in `packages/universe-core` MUST match it and are golden-tested.
- Monorepo: pnpm workspaces + Turborepo. Internal packages are consumed as TypeScript source (`exports: ./src/index.ts`), no build step.
- Authoritative placement/bake runs only in Node (`packages/pipeline`, `apps/worker`). The browser never computes positions that must match the server.
- Money never buys physical attributes: cosmetics live in `apps/web/scene/cosmetics` and never write star radius/temperature/luminosity/position.
- Commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm dev` (web on :3000, zero-config local mode with an embedded Postgres).
- Implement one milestone (§16) at a time; don't start the next until the previous one's acceptance tests pass.
