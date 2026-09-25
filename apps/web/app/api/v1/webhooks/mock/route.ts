import { localMode } from '@/lib/server/app';
import { problem } from '@/lib/server/errors';
import { handlePaymentWebhook } from '@/lib/server/webhooks';

/** Local mode only: signed by the mock checkout page. Refused everywhere else. */
export const POST = (req: Request) => (localMode() ? handlePaymentWebhook('mock', req) : Promise.resolve(problem(404, 'not_found')));
