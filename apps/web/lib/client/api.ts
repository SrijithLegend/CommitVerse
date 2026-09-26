/** Typed client for /api/v1. Errors surface as ApiProblem (RFC 9457). */
import type { FeedEvent, JobDto, LeaderboardRow, Position, SearchResult, ShopItem, StarBrief, StarDetail } from '@commitverse/contracts';

export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path.startsWith('/') ? path : `/api/v1/${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let p: { code?: string; detail?: string; title?: string } = {};
    try {
      p = await res.json();
    } catch {}
    throw new ApiProblem(res.status, p.code ?? 'error', p.detail ?? p.title ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const Api = {
  search: (q: string, signal?: AbortSignal) => api<{ results: SearchResult[] }>(`search?q=${encodeURIComponent(q)}`, { signal }),
  star: (login: string) => api<StarDetail>(`stars/${encodeURIComponent(login)}`),
  position: (login: string) => api<Position>(`stars/${encodeURIComponent(login)}/position`),
  briefs: (ids: number[]) => api<{ stars: StarBrief[] }>(`stars/by-id/brief?ids=${ids.join(',')}`),
  materialize: (login: string, turnstile?: string) =>
    api<{ jobId: string | null; status: 'queued' | 'mapped'; login: string; queuePosition?: number; budgetLow?: boolean }>(
      `stars/${encodeURIComponent(login)}/materialize`,
      { method: 'POST', headers: turnstile ? { 'cf-turnstile-response': turnstile } : {} },
    ),
  refresh: (login: string) => api<{ queued: boolean }>(`stars/${encodeURIComponent(login)}/refresh`, { method: 'POST' }),
  job: (id: string) => api<JobDto>(`jobs/${id}`),
  universe: () =>
    api<{ bakeVersion: string; manifestUrl: string; deltaUrl: string; deltaEtag: string | null; starCount: number }>('universe/current'),
  feed: (cursor?: number) => api<{ events: FeedEvent[]; nextCursor: number | null }>(`feed${cursor ? `?cursor=${cursor}` : ''}`),
  leaderboard: (scope: string, metric: string, cursor = 0, me?: string) =>
    api<{ rows: LeaderboardRow[]; nextCursor: number | null; total: number; meRank?: number | null }>(
      `leaderboards/${encodeURIComponent(scope)}?metric=${metric}&cursor=${cursor}${me ? `&me=${encodeURIComponent(me)}` : ''}`,
    ),
  me: () => api<Me>('me'),
  patchMe: (body: Record<string, unknown>) => api<{ ok: true }>('me', { method: 'PATCH', json: body }),
  checkin: () => api<{ granted: number; streak: number; balance: number }>('me/checkin', { method: 'POST' }),
  equip: (slot: string, inventoryId: string | null) => api<{ ok: true }>('me/equip', { method: 'POST', json: { slot, inventoryId } }),
  stats: (body: Record<string, unknown>) => api<{ ok: true }>('me/stats', { method: 'POST', json: body }).catch(() => undefined),
  shop: () => api<{ items: ShopItem[] }>('shop/items'),
  redeem: (itemId: string) => api<{ inventoryId: string; balance: number }>('shop/redeem', { method: 'POST', json: { itemId } }),
  checkout: (itemId: string, giftTo?: string, anonymous?: boolean) =>
    api<{ checkoutUrl: string; orderId: string }>('checkout', { method: 'POST', json: { itemId, giftTo, anonymous } }),
  signal: (to: string, message?: string) => api<{ id: number }>('signals', { method: 'POST', json: { to, message } }),
  openGift: (id: string, equip: boolean) => api<{ itemId: string }>(`gifts/${id}/open${equip ? '?equip=1' : ''}`, { method: 'POST' }),
  bind: (login: string) => api<{ id: string }>('bindings', { method: 'POST', json: { with: login } }),
  binding: (id: string, action: 'accept' | 'decline' | 'dissolve') =>
    api<{ ok: true }>(`bindings/${id}`, { method: 'PATCH', json: { action } }),
  notifications: () => api<{ notifications: NotificationDto[]; unread: number }>('notifications'),
  readNotifications: (ids?: number[]) => api<{ ok: true }>('notifications/read', { method: 'POST', json: { ids } }),
  shareView: (camera: {
    pos: [number, number, number];
    quat: [number, number, number, number];
    focus: string | null;
    tier?: string;
    t: number;
  }) => api<{ id: string; url: string }>('views', { method: 'POST', json: { camera } }),
  report: (targetType: string, targetId: string, reason: string) =>
    api<{ id: number }>('reports', { method: 'POST', json: { targetType, targetId, reason } }),
};

export interface NotificationDto {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export interface Me {
  githubId: number;
  login: string;
  claimed: boolean;
  isAdmin: boolean;
  account: {
    role: string;
    claimedAt: string;
    referralCode: string;
    bioOverride: string | null;
    pinnedOverride: number[] | null;
    country: string | null;
    settings: Record<string, unknown>;
    stardust: number;
    onboardingDone: boolean;
    syncEnabled: boolean;
  } | null;
  inventory: { id: string; itemId: string; slot: string; name: string; rarity: string; source: string; acquiredAt: string }[];
  equipped: Record<string, { inventoryId: string; itemId: string }>;
  gifts: { id: string; itemId: string; from: string | null; anonymous: boolean; state: string; expiresAt: string }[];
  bindings: { id: string; status: string; other: string; requestedByMe: boolean }[];
  unreadNotifications: number;
  banner: { text: string; status: string } | null;
  checkin: { lastOn: string | null; streak: number };
}
