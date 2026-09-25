/** Device flow for the VS Code extension — against Commitverse, not GitHub (F16). */
import { randomInt } from 'node:crypto';
import { randomToken } from '@commitverse/pipeline';
import { json, route } from '@/lib/server/api';
import { db, env } from '@/lib/server/app';

const ALPHA = 'BCDFGHJKLMNPQRSTVWXZ';
const userCode = () => {
  const pick = () => ALPHA[randomInt(ALPHA.length)];
  return `${Array.from({ length: 4 }, pick).join('')}-${Array.from({ length: 4 }, pick).join('')}`;
};

export const POST = route({ limits: [{ name: 'device', max: 10, windowS: 3600 }] }, async () => {
  const deviceCode = randomToken(24);
  const code = userCode();
  await (await db()).query(
    `insert into beacon_device_codes (device_code, user_code, expires_at) values ($1, $2, now() + interval '15 minutes')`,
    [deviceCode, code],
  );
  return json({
    device_code: deviceCode,
    user_code: code,
    verification_uri: `${env().APP_URL}/beacon`,
    verification_uri_complete: `${env().APP_URL}/beacon?code=${code}`,
    interval: 5,
    expires_in: 900,
  });
});
