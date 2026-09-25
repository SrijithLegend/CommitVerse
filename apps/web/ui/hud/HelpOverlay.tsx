'use client';
/** F1: every shortcut listed in the ? overlay — and remappable (stored per viewer in localStorage). */
import { Button, Dialog, Kbd } from '@commitverse/ui-kit';
import { useState } from 'react';
import { DEFAULT_KEYS, type KeyAction, useSettings } from '@/lib/client/settings';
import { useUniverse } from '@/stores/universe';

const LABELS: Record<KeyAction, string> = {
  flight: 'Toggle flight',
  forward: 'Thrust forward',
  back: 'Thrust back',
  left: 'Strafe left',
  right: 'Strafe right',
  up: 'Up',
  down: 'Down',
  rollLeft: 'Roll left',
  rollRight: 'Roll right',
  boost: 'Boost ×8',
  search: 'Search',
  chart: 'Star chart',
  constellations: 'Constellations overlay',
  share: 'Screenshot / share',
  home: 'Home (my star)',
  back_target: 'Back to previous target',
  help: 'Help',
  galaxy: 'Galaxy view',
  supercluster: 'Supercluster view',
  warp: 'Warp to hovered / selected',
};

const pretty = (code: string) => code.replace(/^Key/, '').replace(/^Digit/, '').replace('Shift+Slash', '?').replace('Slash', '/').replace('ControlLeft', 'Ctrl').replace('ShiftLeft', 'Shift');

export function HelpOverlay() {
  const keys = useSettings((s) => s.keys);
  const setKey = useSettings((s) => s.setKey);
  const [listening, setListening] = useState<KeyAction | null>(null);
  const close = () => useUniverse.getState().set({ overlay: null });
  return (
    <Dialog open onOpenChange={(o) => !o && close()} title="Controls" description="Click a key to remap it. Mouse: drag to orbit, right-drag or Shift-drag to pan, wheel to zoom, click to select, double-click to warp." wide>
      <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
        {(Object.keys(LABELS) as KeyAction[]).map((a) => (
          <li key={a} className="flex items-center justify-between py-1 text-sm">
            <span className="text-[var(--ink-2)]">{LABELS[a]}</span>
            <button
              type="button"
              className="rounded px-1"
              aria-label={`Remap ${LABELS[a]}`}
              onClick={() => setListening(a)}
              onKeyDown={(e) => {
                if (listening !== a) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.key !== 'Escape') setKey(a, e.shiftKey && e.code === 'Slash' ? 'Shift+Slash' : e.code);
                setListening(null);
              }}
            >
              {listening === a ? <Kbd>press a key…</Kbd> : <Kbd>{pretty(keys[a])}</Kbd>}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-2 text-xs text-[var(--ink-3)] sm:grid-cols-3">
        <div>Touch: 1-finger orbit · pinch zoom · 2-finger pan · double-tap warp. In flight: left joystick, right-half look.</div>
        <div>Gamepad: sticks move/look · triggers zoom · A select/warp · B back · Start fly · Select chart.</div>
        <div>
          <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd> also opens search.
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button size="sm" variant="quiet" onClick={() => useSettings.getState().set({ keys: { ...DEFAULT_KEYS } })}>
          Reset to defaults
        </Button>
      </div>
    </Dialog>
  );
}
