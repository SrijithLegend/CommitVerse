# Performance results (§12)

Record pre-release runs on **real reference hardware** here. CI only enforces what it can measure: bundle sizes
(`scripts/check-bundle-size.mjs`) and deterministic frames under SwiftShader (`e2e/visual.spec.ts`). Every row must be
filled before launch. A regression of more than 10% needs a written waiver. Never enter a number that wasn't measured.

## How to run
- **FPS (scripted flight)**: `pnpm --filter @commitverse/web bench [baseUrl] [tier]` drives `/bench` in a real Chrome
  and prints JSON (tier `high` = the §12 High row; `auto` = what users get; `--swiftshader` = the CI CPU-side run).
  On a phone, open `<baseUrl>/bench` and press **Run benchmark**.
- **API**: `k6 run -e BASE_URL=<staging> perf/k6-api.js` (thresholds are built into the script).
- **Presence**: `RT=wss://<realtime> SECRET=<staging secret> N=500 node perf/ws-sector.mjs`.
- **Bake (1M)**: on staging, `pnpm seed 1000000`, then read `bakes.duration_ms` in the admin console.

## Budget status

| Metric | Budget | Result | Date / build | Device |
|---|---|---|---|---|
| Landing initial JS (gzip) | ≤ 180 KB | **162.1 KB ✅** | 2026-09-27 · prod build · CI script | — |
| Largest lazy (3D) chunk (gzip) | ≤ 650 KB | **480.6 KB ✅** | 2026-09-27 · prod build · CI script | — |
| FPS High, reference laptop (M1 / GTX 1650-class) | p50 ≥ 60, p5 ≥ 50 | NOT MEASURED: needs a production build on reference-class hardware (see the laptop runs below) | | |
| FPS Low, reference phone (iPhone 12 / Pixel 6) | p50 ≥ 30, p5 ≥ 24 | NOT MEASURED: requires a physical phone | | |
| Main-thread JS per frame | ≤ 4 ms p95 | NOT MEASURED | | |
| GPU memory | ≤ 350 / 150 MB | NOT MEASURED | | |
| Landing LCP (4G mid phone) | ≤ 2.5 s | NOT MEASURED: requires a deployed build + phone | | |
| `GET /stars/:login` p95 | ≤ 150 ms cached / 400 ms DB | BLOCKED: no staging environment yet | | k6 staging |
| Search p95 | ≤ 120 ms | BLOCKED: no staging environment yet | | k6 staging |
| 500 WS clients in one sector | ≥ 4 snapshots/s, ≤ 50 ships | BLOCKED: realtime not deployed yet | | ws-sector.mjs |
| Bake (1M) | ≤ 15 min | BLOCKED: no staging database yet | | Fly 4 GB |

## Measured runs

### 2026-09-27 · developer laptop · integrated GPU · `next dev` (not a budget verdict)
Conditions: Windows 11, Chrome 153, 1920×1080 at DPR 1, **Intel UHD Graphics (Raptor Lake iGPU, D3D11)**. Chrome
defaulted to the iGPU even though the machine also has an RTX 4050 Laptop GPU. Intel i5-13420H. Local mode:
**development server, 20,000-star synthetic universe** (the §12 targets assume a production build and 1M stars).
Scripted `/bench` flight, about 34 s.

| Tier | fps p50 | fps p5 | frame p95 | points | draw calls (far) |
|---|---|---|---|---|---|
| `high` (forced) | 48 | 21 | 48.6 ms | 19,999 | 1 |
| `auto` (detected **ultra**, adaptive on) | 72 | 29 | 34.7 ms | 19,999 | 1 |
| `low` (forced) | 71 | 35 | 28.5 ms | 19,999 | 1 |

What this tells us:
1. **p5 stays at ≈ 30 fps even at the Low tier**, while p50 is ≈ 70. So the drops are frame-time spikes (main thread:
   dev-mode React, tile streaming, warps, GC), not steady GPU load. Re-measure on a production build before treating
   this as a regression. If spikes remain, profile the warp / tile-upload frames first.
2. **Tier detection picked `ultra` for an integrated GPU** (detect-gpu tier 3, 12 threads, 8+ GB). Adaptive quality
   recovers p50 (72 fps) by lowering DPR, so users aren't stuck, but the first seconds run heavier than needed.
   Revisit the `detectTier` thresholds once there's data from more iGPUs. One data point isn't enough to change the
   heuristic.
