'use client';
import { Button, compact } from '@commitverse/ui-kit';
import { Bell, Menu, Sparkles, User } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useMe } from './Providers';
import { Search } from './Search';

const Notifications = dynamic(() => import('./Notifications').then((m) => m.Notifications));

const NAV = [
  { href: '/leaderboards', label: 'Leaderboards' },
  { href: '/census', label: 'Census' },
  { href: '/chart', label: 'Star chart' },
  { href: '/replay', label: 'Big Bang' },
  { href: '/shop', label: 'Shop' },
];

export function TopBar() {
  const { data: me } = useMe();
  const path = usePathname();
  const [bellOpen, setBellOpen] = useState(false);
  const signinHref = `/auth/signin?next=${encodeURIComponent(path ?? '/')}`;
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-center gap-3 px-3 pt-3 sm:px-4">
      <Link href="/" className="pointer-events-auto flex items-center gap-2 rounded-[10px] px-2 py-1.5" aria-label="Commitverse home">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="3.2" fill="#ffd9a0" />
          <circle cx="12" cy="12" r="8" fill="none" stroke="#7cc4ff" strokeOpacity=".6" strokeWidth="1" />
          <circle cx="20" cy="12" r="1.4" fill="#7cc4ff" />
        </svg>
        <span className="hidden font-mono text-[13px] tracking-[0.18em] text-[var(--ink-1)] sm:inline">COMMITVERSE</span>
      </Link>
      <div className="hidden flex-1 justify-center md:flex">
        <Search />
      </div>
      <nav className="pointer-events-auto ml-auto hidden items-center gap-1 lg:flex" aria-label="Primary">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${path?.startsWith(n.href) ? 'text-[var(--ink-1)]' : 'text-[var(--ink-2)] hover:text-[var(--ink-1)]'}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="pointer-events-auto ml-auto flex items-center gap-2 lg:ml-2">
        {me?.claimed && me.account && (
          <Link
            href="/shop"
            className="glass flex h-9 items-center gap-1.5 px-3 font-mono text-[13px] text-[var(--ink-1)]"
            title="Stardust balance"
          >
            <Sparkles size={14} className="text-[var(--accent)]" aria-hidden />
            <span className="num">{compact(me.account.stardust)}</span>
            <span className="sr-only">Stardust</span>
          </Link>
        )}
        {me && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setBellOpen((o) => !o)}
              className="glass relative flex h-9 w-9 items-center justify-center text-[var(--ink-2)] hover:text-[var(--ink-1)]"
              aria-label={`Notifications${me.unreadNotifications ? ` (${me.unreadNotifications} unread)` : ''}`}
            >
              <Bell size={16} />
              {me.unreadNotifications > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--accent)]" />}
            </button>
            {bellOpen && <Notifications onClose={() => setBellOpen(false)} />}
          </div>
        )}
        {me ? (
          <>
            <button
              type="button"
              popoverTarget="cv-account-menu"
              className="glass flex h-9 items-center gap-2 pl-1 pr-3 text-[13px] text-[var(--ink-1)]"
              aria-label="Account menu"
            >
              {/* biome-ignore lint/performance/noImgElement: avatar */}
              <img
                src={`https://avatars.githubusercontent.com/u/${me.githubId}?s=56`}
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 rounded-[8px]"
              />
              <span className="hidden sm:inline">@{me.login}</span>
            </button>
            <nav id="cv-account-menu" popover="auto" aria-label="Account" className={`glass min-w-48 p-1 text-sm ${MENU}`}>
              <MenuLink href={`/@${me.login}`}>My star</MenuLink>
              <MenuLink href="/settings">Settings</MenuLink>
              <MenuLink href="/shop">Inventory & shop</MenuLink>
              {me.isAdmin && <MenuLink href="/admin">Admin</MenuLink>}
              {!me.claimed && <MenuLink href={signinHref}>Claim your star</MenuLink>}
              <hr className="my-1 h-px border-0 bg-[var(--panel-border)]" />
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="w-full rounded-md px-3 py-2 text-left text-[var(--ink-2)] outline-none hover:bg-[rgba(124,196,255,0.08)] hover:text-[var(--ink-1)] focus-visible:bg-[rgba(124,196,255,0.08)]"
                >
                  Sign out
                </button>
              </form>
            </nav>
          </>
        ) : (
          <a href={signinHref}>
            <Button variant="primary" size="sm" icon={<User size={14} />}>
              Claim your star
            </Button>
          </a>
        )}
        <button
          type="button"
          popoverTarget="cv-site-menu"
          className="glass flex h-9 w-9 items-center justify-center text-[var(--ink-2)] lg:hidden"
          aria-label="Menu"
        >
          <Menu size={16} />
        </button>
        <nav id="cv-site-menu" popover="auto" aria-label="Site" className={`glass min-w-56 p-2 ${MENU}`}>
          <div className="mb-2 md:hidden">
            <Search />
          </div>
          {NAV.map((n) => (
            <MenuLink key={n.href} href={n.href}>
              {n.label}
            </MenuLink>
          ))}
          <MenuLink href="/achievements">Achievements</MenuLink>
          <MenuLink href="/feed">Cosmic feed</MenuLink>
        </nav>
      </div>
      <span className="sr-only" aria-live="polite">
        {me ? `Signed in as ${me.login}` : ''}
      </span>
    </header>
  );
}

// Native popovers (top layer, light-dismiss, Esc) instead of a JS menu library — keeps the landing bundle in budget (§12).
const MENU = 'fixed inset-auto right-3 top-14 m-0 text-[var(--ink-1)]';

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      onClick={(e) => (e.currentTarget.closest('[popover]') as HTMLElement | null)?.hidePopover()}
      className="block rounded-md px-3 py-2 text-[var(--ink-2)] outline-none hover:bg-[rgba(124,196,255,0.08)] hover:text-[var(--ink-1)] focus-visible:bg-[rgba(124,196,255,0.08)]"
    >
      {children}
    </Link>
  );
}
