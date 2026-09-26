# Runbook — Data removal request

**Trigger:** email to the privacy contact, a GDPR/DPDP erasure request, or a GitHub user who can't sign in asking to
be removed. **SLA:** act within 72 h, confirm within 30 days (GDPR Art. 12).

## Self-service (preferred; point people here first)
Signed-in users: Settings → Danger zone → **Remove my star**. This:
- sets `github_users.is_opted_out = true`. The login is then **tombstoned**: `/@login` returns **410 Gone**,
  and `materialize` refuses with 410, so the star can't re-form from public data.
- deletes `bodies`, `accounts`, equipped cosmetics and the session.
- drops the star from the next bake. Until then it's hidden from search, leaderboards, the sitemap and the feed.

Covered by the E2E test `remove my star → 410 Gone, and it cannot re-form`.

## Manual request (the person can't or won't sign in)
1. **Verify identity.** Ask them to add a gist or a line to their GitHub profile README containing a code you send
   them, or to email from the address on their public GitHub profile. Never act on an unverified request.
2. Admin console → Users → find the login → **Ban** (hides everything immediately), then run:
   ```sql
   begin;
   update github_users set is_opted_out = true where github_id = :id;
   delete from equipped where github_id = :id;
   delete from bodies where github_id = :id;
   delete from accounts where github_id = :id;
   delete from archive_daily where github_id = :id;
   delete from archive_hours where github_id = :id;
   commit;
   ```
   Keep the `github_users` row (the tombstone). Deleting it would let the star re-form on the next crawl.
3. Orders and `payment_events` are **kept** for 8 years because tax law requires it. Say so in the reply (the
   privacy policy covers this).
4. Trigger a bake (Admin → Bakes → Run bake now) or let the nightly bake drop the star.
5. Log it: Admin → Audit shows the ban. Add the ticket id to the audit note.
6. Reply to confirm removal. Include the retention note about payment records.

## Export instead of deletion
Signed-in users: Settings → **Export my data** (`GET /api/v1/me/export`, JSON).
