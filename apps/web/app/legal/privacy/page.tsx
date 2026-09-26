import type { Metadata } from 'next';
import { PageShell } from '@/ui/PageShell';
import { SceneIntent } from '@/ui/SceneIntent';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function Privacy() {
  return (
    <PageShell title="Privacy policy" kicker="Plain language · last updated 2026-09-26">
      <SceneIntent intent={{ type: 'dim' }} dim />
      <article className="glass prose-cv p-6">
        <p>
          Commitverse turns public GitHub activity into a 3D universe. This page lists exactly what we process and why. We are the data
          fiduciary under India’s Digital Personal Data Protection Act 2023 and we honour GDPR-style rights for visitors from the EU.
        </p>
        <h2>What we read from GitHub (public data only)</h2>
        <table>
          <tbody>
            <tr>
              <th>Field</th>
              <th>Why</th>
            </tr>
            <tr>
              <td>Account id, login, name, avatar, bio, creation date</td>
              <td>To identify and label your star</td>
            </tr>
            <tr>
              <td>Yearly and daily public contribution counts</td>
              <td>Star radius (all-time) and temperature (last 30 days)</td>
            </tr>
            <tr>
              <td>Followers, following, public non-fork repos (name, description, stars, forks, releases, languages, push date)</td>
              <td>Luminosity, planets, moons, rings, galaxy</td>
            </tr>
            <tr>
              <td>Public organisation membership</td>
              <td>Constellations</td>
            </tr>
            <tr>
              <td>Public events (pushes, merged PRs, releases) — claimed users only</td>
              <td>Live comets</td>
            </tr>
          </tbody>
        </table>
        <p>
          Private contribution counts appear only if you enabled “show private contributions” on GitHub. We never request the{' '}
          <code>repo</code> scope; sign-in asks only for <code>read:user</code>. We never infer demographics. Country is optional and only
          ever set by you.
        </p>
        <h2>What we store when you claim your star</h2>
        <ul>
          <li>The link between your sign-in and your GitHub id, your settings, cosmetics, Stardust ledger, signals, gifts and orders.</li>
          <li>
            If you opt in to “Sync with my token”, your OAuth token encrypted with AES-256-GCM; it is used only to refresh your own data and
            is never logged.
          </li>
          <li>
            If you use the VS Code Beacon: the language you are editing and a timestamp. Never file names, paths, repository names or code.
          </li>
        </ul>
        <h2>Payments</h2>
        <p>Card details are handled entirely by our payment provider (Stripe or Paddle); they never touch our servers.</p>
        <h2>Analytics</h2>
        <p>
          Product analytics (when enabled) anonymise IP addresses, mask the 3D canvas and all inputs in session replays, and honour
          Do-Not-Track. We use no advertising cookies and do not sell or export data.
        </p>
        <h2>Your rights</h2>
        <ul>
          <li>
            <strong>Remove my star</strong> — any GitHub user can prove identity with GitHub sign-in (claiming isn’t required) and remove
            themselves in Settings. The star disappears within minutes; metrics, repos, social data and inventory are deleted within 24
            hours. Only your numeric GitHub id remains, solely to stop the star from re-forming.
          </li>
          <li>
            <strong>Export</strong> — download everything we store about you as JSON from Settings.
          </li>
          <li>
            <strong>Correction</strong> — use Refresh on your star, or edit your bio and pinned planets.
          </li>
        </ul>
        <h2>Contact</h2>
        <p>Privacy requests: privacy@commitverse.dev. Commitverse is not affiliated with or endorsed by GitHub, Inc.</p>
      </article>
    </PageShell>
  );
}
