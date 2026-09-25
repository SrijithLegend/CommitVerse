import pino from 'pino';

/** Structured JSON logs (§13.2). Token-ish fields are always redacted (§11.2). */
export const log = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: process.env.SERVICE_NAME ?? 'commitverse' },
  redact: {
    paths: [
      'token',
      '*.token',
      'authorization',
      '*.authorization',
      'headers.authorization',
      'syncToken',
      '*.syncToken',
      'password',
      '*.secret',
    ],
    censor: '[redacted]',
  },
});
