import type { Metadata } from 'next';
import { PageShell } from '@/ui/PageShell';
import { SceneIntent } from '@/ui/SceneIntent';

export const metadata: Metadata = { title: 'Terms of service' };

export default function Terms() {
  return (
    <PageShell title="Terms of service" kicker="Last updated 2026-09-26">
      <SceneIntent intent={{ type: 'dim' }} dim />
      <article className="glass prose-cv p-6">
        <p>By using Commitverse you agree to these terms. Commitverse is not affiliated with or endorsed by GitHub, Inc.</p>
        <h2>The universe</h2>
        <p>
          Stars are generated from public GitHub data using documented formulas (see “Why does my star look like this?”). Positions, sizes and ranks can change at each
          nightly bake. We don’t judge or verify how that public data was produced.
        </p>
        <h2>Accounts</h2>
        <p>You may claim only your own GitHub account. One GitHub account can be claimed by exactly one Commitverse account. We may suspend accounts that abuse the service.</p>
        <h2>Your content</h2>
        <p>
          Bios, banners and signal messages must not be abusive, hateful or illegal. Banners are reviewed before they appear publicly; everything can be reported and
          removed.
        </p>
        <h2>Cosmetics, Stardust and purchases</h2>
        <ul>
          <li>Cosmetics are purely visual. They never change a star’s size, temperature, luminosity, position or rank.</li>
          <li>Stardust is earned only through activity; it cannot be bought, sold, transferred or exchanged for money.</li>
          <li>Premium cosmetics are a limited, non-transferable licence to display the item in Commitverse. See the refund policy.</li>
        </ul>
        <h2>Acceptable use</h2>
        <p>Don’t scrape the API at scale, attempt to circumvent rate limits, farm referrals with fake accounts, or interfere with other explorers.</p>
        <h2>Availability & liability</h2>
        <p>The service is provided “as is”. To the extent permitted by law we are not liable for indirect losses. These terms are governed by the laws of India.</p>
      </article>
    </PageShell>
  );
}
