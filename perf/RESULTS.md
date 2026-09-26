# Performance results (§12)

Record pre-release runs on **real reference hardware** here. CI only enforces what it can measure (bundle sizes via
`scripts/check-bundle-size.mjs`, CPU frame budget under SwiftShader). Fill in every row before launch. A regression
of more than 10% needs a written waiver.

## How to run
- **FPS**: open `/bench` on the device (it runs the scripted flight and prints p50/p5 fps plus main-thread ms/frame).
- **API**: `k6 run -e BASE_URL=<staging> perf/k6-api.js` (thresholds are built into the script).
- **Presence**: `RT=wss://<realtime> SECRET=<staging secret> N=500 node perf/ws-sector.mjs`.
- **Bake (1M)**: on staging, `pnpm seed 1000000`, then read `bakes.duration_ms` in the admin console.

## Latest

| Metric | Budget | Result | Date / build | Device |
|---|---|---|---|---|
| Landing initial JS (gzip) | ≤ 180 KB | 162 KB | 2026-09-26 · CI script | — |
| Largest lazy (3D) chunk (gzip) | ≤ 650 KB | 481 KB | 2026-09-26 · CI script | — |
| FPS High, reference laptop | p50 ≥ 60, p5 ≥ 50 | _pending_ | | M1 / GTX 1650 |
| FPS Low, reference phone | p50 ≥ 30, p5 ≥ 24 | _pending_ | | iPhone 12 / Pixel 6 |
| Main-thread JS per frame | ≤ 4 ms p95 | _pending_ | | |
| GPU memory | ≤ 350 / 150 MB | _pending_ | | |
| Landing LCP (4G mid phone) | ≤ 2.5 s | _pending_ | | |
| `GET /stars/:login` p95 | ≤ 150 ms cached / 400 ms DB | _pending_ | | k6 staging |
| Search p95 | ≤ 120 ms | _pending_ | | k6 staging |
| 500 WS clients in one sector | ≥ 4 snapshots/s, ≤ 50 ships | _pending_ | | ws-sector.mjs |
| Bake (1M) | ≤ 15 min | _pending_ | | Fly 4 GB |
