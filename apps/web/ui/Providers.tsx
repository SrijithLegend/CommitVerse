'use client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Api, type Me } from '@/lib/client/api';
import { unlockAudio } from '@/lib/client/audio';
import { subscribe } from '@/lib/client/realtime';
import { useSettings } from '@/lib/client/settings';
import { initTelemetry } from '@/lib/client/telemetry';
import { Toaster, toast } from './Toaster';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } }),
  );
  useEffect(() => {
    void useSettings.persist.rehydrate();
    void initTelemetry();
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  return (
    <QueryClientProvider client={client}>
      <UserChannel />
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: () => Api.me().catch((e) => (e?.status === 401 ? null : Promise.reject(e))),
    staleTime: 15_000,
  });
}

const NOTIFY_TEXT: Record<string, (p: Record<string, unknown>) => string> = {
  signal: () => 'A signal just arrived at your star ✦',
  achievement: (p) => `Achievement unlocked: ${p.name} (+${p.stardust} ✦)`,
  gift_received: () => 'A gift pod is orbiting your star — open it!',
  drift: (p) => String(p.message ?? 'Your star drifted.'),
  supernova: () => 'Your star went supernova! 250 ✦ earned.',
  binding_request: () => 'Someone wants to form a binary system with you.',
  binding_accepted: () => 'Binary system formed.',
  order_paid: () => 'Purchase complete — your item is in your inventory.',
  claimed: (p) => String(p.message ?? 'Your star ignited.'),
  referral_verified: () => 'A referral was verified: +100 ✦',
  banner_moderated: (p) => `Your banner was ${p.decision}.`,
  sync_token_revoked: () => 'GitHub rejected your sync token; we removed it.',
};

/** user:{githubId} — notifications, gift arrivals, drift. */
function UserChannel() {
  const { data: me, refetch } = useMe();
  useEffect(() => {
    if (!me?.claimed) return;
    return subscribe(`user:${me.githubId}`, (_e, p) => {
      const type = String(p.type ?? '');
      const text = NOTIFY_TEXT[type]?.((p.payload as Record<string, unknown>) ?? {});
      if (text) toast(text);
      void refetch();
    });
  }, [me?.claimed, me?.githubId, refetch]);
  return null;
}
