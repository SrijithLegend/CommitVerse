// §13.1 load test: 1k RPS across search + star detail, and a materialize flood that must be absorbed by the budget
// guard (queued / 429 / 503), never 5xx. Run against staging only:
//   k6 run -e BASE_URL=https://staging.example -e LOGINS=perf/logins.txt perf/k6-api.js
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import http from 'k6/http';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const logins = new SharedArray('logins', () =>
  (__ENV.LOGINS ? open(__ENV.LOGINS).split('\n') : ['torvalds', 'gaearon', 'sindresorhus', 'yyx990803', 'tj']).filter(Boolean),
);
const pick = () => logins[Math.floor(Math.random() * logins.length)];

export const options = {
  discardResponseBodies: true,
  scenarios: {
    search: { executor: 'constant-arrival-rate', rate: 500, timeUnit: '1s', duration: '3m', preAllocatedVUs: 200, exec: 'search' },
    detail: { executor: 'constant-arrival-rate', rate: 500, timeUnit: '1s', duration: '3m', preAllocatedVUs: 200, exec: 'detail' },
    materialize: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '1m',
      startTime: '1m',
      preAllocatedVUs: 50,
      exec: 'materialize',
    },
  },
  // §12: search p95 ≤ 120 ms; detail p95 ≤ 150 ms cached (≤ 400 ms from DB)
  thresholds: {
    'http_req_duration{scenario:search}': ['p(95)<120'],
    'http_req_duration{scenario:detail}': ['p(95)<400'],
    'checks{scenario:materialize}': ['rate>0.99'],
    'http_req_failed{scenario:search}': ['rate<0.01'],
    'http_req_failed{scenario:detail}': ['rate<0.01'],
  },
};

export function search() {
  const l = pick();
  const r = http.get(`${BASE}/api/v1/search?q=${encodeURIComponent(l.slice(0, 1 + Math.floor(Math.random() * l.length)))}`, {
    tags: { name: 'search' },
  });
  check(r, { 'search 200/429': (x) => x.status === 200 || x.status === 429 });
}

export function detail() {
  const r = http.get(`${BASE}/api/v1/stars/${pick()}`, { tags: { name: 'detail' } });
  check(r, { 'detail ok': (x) => x.status === 200 || x.status === 404 || x.status === 429 });
}

export function materialize() {
  const login = `perf-${Math.random().toString(36).slice(2, 12)}`;
  const r = http.post(`${BASE}/api/v1/stars/${login}/materialize`, null, { tags: { name: 'materialize' } });
  // the guard may queue, rate-limit, challenge or shed — but never error
  check(r, { 'materialize guarded': (x) => x.status < 500 || x.status === 503 });
}
