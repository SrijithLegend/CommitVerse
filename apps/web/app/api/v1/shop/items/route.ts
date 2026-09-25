import { route } from '@/lib/server/api';
import { shopItems } from '@/lib/server/shop';

export const GET = route({ cache: 'public, s-maxage=300, stale-while-revalidate=600' }, async () => ({ items: await shopItems() }));
