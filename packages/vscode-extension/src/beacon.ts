/**
 * F16 heartbeat policy, independent of VS Code (unit-tested): send at most every 60 s, only while the editor window is
 * focused AND a file changed in the last 2 minutes. The payload is `{ language }` — nothing else, ever.
 */
export const HEARTBEAT_MS = 60_000;
export const ACTIVE_WINDOW_MS = 120_000;

export interface BeaconState {
  focused: boolean;
  lastEditAt: number;
  lastSentAt: number;
  enabled: boolean;
  language: string | null;
}

export function shouldSend(s: BeaconState, now: number): boolean {
  return s.enabled && s.focused && now - s.lastEditAt <= ACTIVE_WINDOW_MS && now - s.lastSentAt >= HEARTBEAT_MS;
}

/** The only thing that ever leaves the editor. Language ids are VS Code's (e.g. "typescript"), capped at 64 chars. */
export function payload(s: BeaconState): { language: string | null } {
  return { language: s.language ? s.language.slice(0, 64) : null };
}

export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
}
