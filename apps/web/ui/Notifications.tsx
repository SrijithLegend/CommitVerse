'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Api, type NotificationDto } from '@/lib/client/api';

function describe(n: NotificationDto): { text: string; href?: string } {
  const p = n.payload;
  switch (n.type) {
    case 'signal':
      return { text: p.message ? `Signal received: “${p.message}”` : 'You received a signal' };
    case 'achievement':
      return { text: `Achievement unlocked — ${p.name} (+${p.stardust} ✦)`, href: '/achievements' };
    case 'gift_received':
      return { text: 'A gift pod is orbiting your star', href: '/settings#gifts' };
    case 'gift_opened':
      return { text: 'Your gift was opened' };
    case 'drift':
      return { text: String(p.message) };
    case 'supernova':
      return { text: `Supernova! ${p.kind === 'repo_stars' ? `${p.repo} reached` : 'You reached'} ${Number(p.threshold).toLocaleString()} (+250 ✦)` };
    case 'binding_request':
      return { text: 'Binary system request — accept it in settings', href: '/settings#binary' };
    case 'binding_accepted':
      return { text: 'Your binary system formed' };
    case 'binding_dissolved':
      return { text: 'Your binary system dissolved' };
    case 'order_paid':
      return { text: p.gift ? 'Gift purchased — it’s on its way' : 'Purchase complete', href: '/shop' };
    case 'referral_verified':
      return { text: 'A referral was verified (+100 ✦)' };
    case 'banner_moderated':
      return { text: `Your banner was ${p.decision}` };
    case 'item_granted':
      return { text: `You received ${p.itemId}`, href: '/shop' };
    case 'claimed':
      return { text: String(p.message ?? 'Your star ignited') };
    case 'sync_token_revoked':
      return { text: 'GitHub rejected your sync token; it was removed', href: '/settings' };
    default:
      return { text: n.type.replace(/_/g, ' ') };
  }
}

export function Notifications({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: Api.notifications });
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  useEffect(() => {
    if (data?.unread)
      void Api.readNotifications().then(() => {
        void qc.invalidateQueries({ queryKey: ['me'] });
      });
  }, [data?.unread, qc]);
  return (
    <div ref={ref} className="glass absolute right-0 top-11 z-50 w-80 p-1" role="dialog" aria-label="Notifications">
      <div className="label px-3 py-2">Notifications</div>
      {!data?.notifications.length && <p className="px-3 pb-3 text-sm text-[var(--ink-3)]">Nothing yet. The universe is quiet.</p>}
      <ul className="scroll-thin max-h-96 overflow-auto">
        {data?.notifications.map((n) => {
          const d = describe(n);
          const body = (
            <>
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-[var(--accent)]'}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-[var(--ink-1)]">{d.text}</span>
                <span className="block font-mono text-[11px] text-[var(--ink-3)]">{new Date(n.createdAt).toLocaleString()}</span>
              </span>
            </>
          );
          return (
            <li key={n.id}>
              {d.href ? (
                <Link href={d.href} onClick={onClose} className="flex gap-2.5 rounded-lg px-3 py-2 hover:bg-[rgba(124,196,255,0.06)]">
                  {body}
                </Link>
              ) : (
                <div className="flex gap-2.5 rounded-lg px-3 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
