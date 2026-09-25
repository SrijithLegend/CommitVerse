/**
 * F1 controls: keyboard (remappable), mouse (orbit / pan / zoom / pointer-lock look), touch (orbit, pinch, 2-finger pan,
 * virtual joystick + right-half look in flight), gamepad. Produces one InputState per frame; nothing goes through React.
 */
import { type KeyAction, useSettings } from '@/lib/client/settings';

export interface GamepadState {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  up: number;
  roll: number;
  zoom: number;
  boost: boolean;
}

export interface InputState {
  keys: Set<KeyAction>;
  drag: boolean;
  dx: number;
  dy: number;
  wheel: number;
  pinch: number;
  pan: [number, number] | null;
  lookX: number;
  lookY: number;
  stick: [number, number] | null;
  gamepad: GamepadState | null;
  anyInput: boolean;
}

type Listener = (action: KeyAction, e: KeyboardEvent) => void;

const DEAD = 0.15;
const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

export class InputController {
  state: InputState = {
    keys: new Set(),
    drag: false,
    dx: 0,
    dy: 0,
    wheel: 0,
    pinch: 0,
    pan: null,
    lookX: 0,
    lookY: 0,
    stick: null,
    gamepad: null,
    anyInput: false,
  };
  flight = false;
  private buttons = 0;
  private last: { x: number; y: number } | null = null;
  private touches = new Map<number, { x: number; y: number; startX: number; startY: number }>();
  private pinchDist = 0;
  private pinchCenter: { x: number; y: number } | null = null;
  private stickId: number | null = null;
  private stickOrigin: { x: number; y: number } | null = null;
  private onAction = new Set<Listener>();
  private cleanup: (() => void)[] = [];
  private gamepadPrev = new Map<number, boolean>();
  private tapTime = 0;
  onTap: ((x: number, y: number, double: boolean) => void) | null = null;
  onHover: ((x: number, y: number) => void) | null = null;
  onGamepadButton: ((button: 'a' | 'aHold' | 'b' | 'start' | 'select') => void) | null = null;

  constructor(private el: HTMLElement) {
    const on = <K extends keyof HTMLElementEventMap>(t: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(t, fn, opts);
      this.cleanup.push(() => el.removeEventListener(t, fn));
    };
    const onWin = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(t, fn);
      this.cleanup.push(() => window.removeEventListener(t, fn));
    };
    on('contextmenu', (e) => e.preventDefault());
    on('pointerdown', (e) => this.pointerDown(e));
    onWin('pointermove', (e) => this.pointerMove(e));
    onWin('pointerup', (e) => this.pointerUp(e));
    onWin('pointercancel', (e) => this.pointerUp(e));
    on('wheel', (e) => {
      e.preventDefault();
      this.state.wheel += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.state.anyInput = true;
    }, { passive: false });
    onWin('keydown', (e) => this.key(e, true));
    onWin('keyup', (e) => this.key(e, false));
    onWin('blur', () => this.state.keys.clear());
    document.addEventListener('pointerlockchange', this.plChange);
    this.cleanup.push(() => document.removeEventListener('pointerlockchange', this.plChange));
    el.style.touchAction = 'none';
  }

  dispose() {
    for (const c of this.cleanup) c();
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  onKeyAction(fn: Listener): () => void {
    this.onAction.add(fn);
    return () => this.onAction.delete(fn);
  }

  setFlight(on: boolean) {
    this.flight = on;
    if (on && matchMedia('(pointer: fine)').matches) this.el.requestPointerLock?.();
    if (!on && document.pointerLockElement === this.el) document.exitPointerLock();
  }

  private plChange = () => {
    // Leaving pointer lock (Esc) keeps flight mode but stops mouse-look until clicked again.
  };

  private actionFor(e: KeyboardEvent): KeyAction | null {
    const keys = useSettings.getState().keys;
    const code = e.shiftKey && e.code === 'Slash' ? 'Shift+Slash' : e.code;
    for (const [action, bound] of Object.entries(keys) as [KeyAction, string][]) {
      if (bound === code) return action;
      if (action === 'boost' && (e.code === 'ShiftLeft' || e.code === 'ShiftRight') && bound.startsWith('Shift')) return action;
      if (action === 'down' && (e.code === 'ControlLeft' || e.code === 'ControlRight') && bound.startsWith('Control')) return action;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') return 'search';
    return null;
  }

  private key(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || t.closest?.('[role="dialog"]'))) return;
    const action = this.actionFor(e);
    if (!action) return;
    const held: KeyAction[] = ['forward', 'back', 'left', 'right', 'up', 'down', 'rollLeft', 'rollRight', 'boost'];
    if (held.includes(action)) {
      if (!this.flight && action !== 'boost') return;
      if (down) this.state.keys.add(action);
      else this.state.keys.delete(action);
      if (action === 'up' || action === 'down') e.preventDefault();
      this.state.anyInput = true;
      return;
    }
    if (down && !e.repeat) {
      if (action === 'search' || action === 'back_target') e.preventDefault();
      for (const l of this.onAction) l(action, e);
      this.state.anyInput = true;
    }
  }

  private pointerDown(e: PointerEvent) {
    this.state.anyInput = true;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
      const rect = this.el.getBoundingClientRect();
      if (this.flight && e.clientX - rect.left < rect.width / 2 && this.stickId === null) {
        this.stickId = e.pointerId;
        this.stickOrigin = { x: e.clientX, y: e.clientY };
      }
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        this.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        this.pinchCenter = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      }
      return;
    }
    this.buttons = e.buttons;
    this.last = { x: e.clientX, y: e.clientY };
    (this as { downAt?: { x: number; y: number; t: number } }).downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (this.flight && matchMedia('(pointer: fine)').matches && document.pointerLockElement !== this.el) this.el.requestPointerLock?.();
  }

  private pointerMove(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      t.x = e.clientX;
      t.y = e.clientY;
      this.state.anyInput = true;
      if (e.pointerId === this.stickId && this.stickOrigin) {
        const sx = Math.max(-1, Math.min(1, (e.clientX - this.stickOrigin.x) / 60));
        const sy = Math.max(-1, Math.min(1, -(e.clientY - this.stickOrigin.y) / 60));
        this.state.stick = [sx, sy];
        return;
      }
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const c = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        if (this.pinchDist > 0) this.state.pinch = (this.state.pinch || 1) * (d / this.pinchDist);
        if (this.pinchCenter) this.state.pan = [(this.state.pan?.[0] ?? 0) + c.x - this.pinchCenter.x, (this.state.pan?.[1] ?? 0) + c.y - this.pinchCenter.y];
        this.pinchDist = d;
        this.pinchCenter = c;
        return;
      }
      if (this.flight) {
        this.state.lookX += dx * 1.2;
        this.state.lookY += dy * 1.2;
      } else {
        this.state.drag = true;
        this.state.dx += dx;
        this.state.dy += dy;
      }
      return;
    }
    if (document.pointerLockElement === this.el) {
      this.state.lookX += e.movementX;
      this.state.lookY += e.movementY;
      this.state.anyInput = true;
      return;
    }
    if (!this.last) {
      this.onHover?.(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - this.last.x;
    const dy = e.clientY - this.last.y;
    this.last = { x: e.clientX, y: e.clientY };
    this.state.anyInput = true;
    const pan = (this.buttons & 2) !== 0 || ((this.buttons & 1) !== 0 && e.shiftKey);
    if (pan) this.state.pan = [(this.state.pan?.[0] ?? 0) + dx, (this.state.pan?.[1] ?? 0) + dy];
    else if (this.buttons & 1) {
      if (this.flight) {
        this.state.lookX += dx;
        this.state.lookY += dy;
      } else {
        this.state.drag = true;
        this.state.dx += dx;
        this.state.dy += dy;
      }
    }
  }

  private pointerUp(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      const t = this.touches.get(e.pointerId);
      this.touches.delete(e.pointerId);
      if (e.pointerId === this.stickId) {
        this.stickId = null;
        this.stickOrigin = null;
        this.state.stick = null;
      }
      if (this.touches.size < 2) {
        this.pinchDist = 0;
        this.pinchCenter = null;
      }
      if (t && Math.hypot(e.clientX - t.startX, e.clientY - t.startY) < 10) this.tap(e.clientX, e.clientY);
      return;
    }
    const down = (this as { downAt?: { x: number; y: number; t: number } }).downAt;
    if (down && this.last && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && performance.now() - down.t < 400 && e.button === 0) {
      this.tap(e.clientX, e.clientY);
    }
    this.last = null;
    this.buttons = 0;
  }

  private tap(x: number, y: number) {
    const now = performance.now();
    const double = now - this.tapTime < 320;
    this.tapTime = now;
    this.onTap?.(x, y, double);
  }

  pollGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    const gp = [...pads].find((p) => p?.connected);
    if (!gp) {
      this.state.gamepad = null;
      return;
    }
    const ax = (i: number) => dz(gp.axes[i] ?? 0);
    const btn = (i: number) => !!gp.buttons[i]?.pressed;
    const val = (i: number) => gp.buttons[i]?.value ?? 0;
    this.state.gamepad = {
      lx: ax(0),
      ly: -ax(1),
      rx: ax(2),
      ry: ax(3),
      up: (btn(5) ? 1 : 0) - (btn(4) ? 1 : 0),
      roll: (btn(14) ? 1 : 0) - (btn(15) ? 1 : 0),
      zoom: val(6) - val(7),
      boost: btn(10),
    };
    if (Object.values(this.state.gamepad).some((v) => (typeof v === 'number' ? v !== 0 : v))) this.state.anyInput = true;
    const edge = (i: number, name: 'a' | 'b' | 'start' | 'select') => {
      const p = btn(i);
      if (p && !this.gamepadPrev.get(i)) this.onGamepadButton?.(name);
      this.gamepadPrev.set(i, p);
    };
    edge(0, 'a');
    edge(1, 'b');
    edge(9, 'start');
    edge(8, 'select');
  }

  /** Called once per frame after the rig consumed the state. */
  reset() {
    const s = this.state;
    s.drag = false;
    s.dx = 0;
    s.dy = 0;
    s.wheel = 0;
    s.pinch = 0;
    s.pan = null;
    s.lookX = 0;
    s.lookY = 0;
    s.anyInput = s.keys.size > 0 || !!s.stick;
  }
}
