'use client';
/**
 * F5 ignition cinematic after a claim (the star flares, a ring pulse expands through the galaxy) and F21 onboarding
 * coach marks (your star → your planets → send your first signal), skippable, never shown twice.
 */
import { Button } from '@commitverse/ui-kit';
import { useEffect, useState } from 'react';
import { play } from '@/lib/client/audio';
import { useSettings } from '@/lib/client/settings';
import { useMe } from '../Providers';

export function Ignition() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const go = () => {
      setOn(true);
      play('supernova');
      setTimeout(() => setOn(false), 3200);
    };
    window.addEventListener('cv:ignite', go);
    return () => window.removeEventListener('cv:ignite', go);
  }, []);
  if (!on) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center overflow-hidden">
      <div className="absolute h-8 w-8 animate-[ignite_1.2s_cubic-bezier(0.2,0.8,0.2,1)_forwards] rounded-full bg-white shadow-[0_0_120px_60px_rgba(255,236,200,0.9)]" />
      <div className="absolute h-10 w-10 animate-[ringPulse_3s_cubic-bezier(0.2,0.8,0.2,1)_forwards] rounded-full border-2 border-[rgba(124,196,255,0.8)]" />
    </div>
  );
}

const STEPS = [
  { title: 'This is your star', body: 'Its size is everything you’ve built, its colour how active you are right now, its glow how much the world notices.' },
  { title: 'These are your planets', body: 'Your top repositories orbit you. Moons are forks, rings are releases. Click one to fly to it.' },
  { title: 'Send your first signal', body: 'Find a developer you admire and send them a signal — a beam of light from your star to theirs.' },
];

export function CoachMarks() {
  const { data: me } = useMe();
  const done = useSettings((s) => s.coachDone);
  const [step, setStep] = useState(0);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const on = () => setTimeout(() => setArmed(true), 3500);
    window.addEventListener('cv:ignite', on);
    return () => window.removeEventListener('cv:ignite', on);
  }, []);
  if (!armed || done || !me?.claimed) return null;
  const s = STEPS[step]!;
  const finish = () => {
    useSettings.getState().set({ coachDone: true });
    setArmed(false);
    void fetch('/api/v1/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: {} }) });
  };
  return (
    <div className="glass pointer-events-auto fixed bottom-40 left-1/2 z-40 w-[min(92vw,360px)] -translate-x-1/2 p-4" role="dialog" aria-label="Getting started">
      <div className="label">
        {step + 1} / {STEPS.length}
      </div>
      <div className="mt-1 text-base text-[var(--ink-1)]">{s.title}</div>
      <p className="mt-1 text-sm text-[var(--ink-2)]">{s.body}</p>
      <div className="mt-4 flex justify-between">
        <Button variant="quiet" size="sm" onClick={finish}>
          Skip
        </Button>
        <Button variant="primary" size="sm" onClick={() => (step + 1 < STEPS.length ? setStep(step + 1) : finish())}>
          {step + 1 < STEPS.length ? 'Next' : 'Done'}
        </Button>
      </div>
    </div>
  );
}
