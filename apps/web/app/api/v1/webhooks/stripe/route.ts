import { handlePaymentWebhook } from '@/lib/server/webhooks';

export const POST = (req: Request) => handlePaymentWebhook('stripe', req);
