import type { ShopItem } from '@commitverse/contracts';
import 'server-only';
import { db } from './app';

export async function shopItems(): Promise<ShopItem[]> {
  const rows = await (await db()).query<{
    id: string;
    slot: ShopItem['slot'];
    name: string;
    description: string;
    rarity: ShopItem['rarity'];
    track: ShopItem['track'];
    price_stardust: number | null;
    price_minor: Record<string, number> | null;
    available_from: Date | null;
    available_until: Date | null;
    render_config: Record<string, unknown>;
    owned_pct: number;
  }>(
    `select i.*, coalesce(100.0 * (select count(*) from inventory v join accounts a on a.github_id = v.owner_id where v.item_id = i.id and v.revoked_at is null)
       / nullif((select count(*) from accounts), 0), 0)::float8 as owned_pct
     from items i where i.active and (i.available_until is null or i.available_until > now() - interval '30 days')
     order by case i.rarity when 'common' then 0 when 'rare' then 1 when 'epic' then 2 when 'legendary' then 3 else 4 end, i.slot, i.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    slot: r.slot,
    name: r.name,
    description: r.description,
    rarity: r.rarity,
    track: r.track,
    priceStardust: r.price_stardust,
    priceMinor: r.price_minor,
    availableFrom: r.available_from?.toISOString() ?? null,
    availableUntil: r.available_until?.toISOString() ?? null,
    renderConfig: r.render_config,
    ownedPct: r.owned_pct,
  }));
}
