/**
 * Unified game input: keyboard, on-screen touch buttons and a virtual
 * joystick all feed the same named buttons used by scripts
 * ("jump", "action", "forward", "back", "left", "right", letters, digits).
 */

const KEY_TO_BUTTON: Record<string, string> = {
  Space: 'jump',
  KeyE: 'action',
  Enter: 'action',
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

export function buttonsForKey(code: string): string[] {
  const out: string[] = [];
  const named = KEY_TO_BUTTON[code];
  if (named) out.push(named);
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) out.push((letter[1] as string).toLowerCase());
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) out.push(digit[1] as string);
  return out;
}

export class InputState {
  private readonly keysDown = new Set<string>();
  private readonly virtualDown = new Set<string>();
  private pressedQueue: string[] = [];
  private joystick = { x: 0, y: 0 };
  private look = { x: 0, y: 0 };
  private target: Window | null = null;

  attach(target: Window): void {
    this.detach();
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.target = null;
    this.reset();
  }

  reset(): void {
    this.keysDown.clear();
    this.virtualDown.clear();
    this.pressedQueue = [];
    this.joystick = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
  }

  private isTypingTarget(event: KeyboardEvent): boolean {
    const el = event.target as HTMLElement | null;
    return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (this.isTypingTarget(event) || event.metaKey || event.ctrlKey) return;
    const buttons = buttonsForKey(event.code);
    if (buttons.length === 0) return;
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    for (const b of buttons) {
      if (!this.isDown(b) && !event.repeat) this.pressedQueue.push(b);
    }
    this.keysDown.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.keysDown.delete(event.code);
  };

  private onBlur = () => {
    this.keysDown.clear();
  };

  /** On-screen buttons call this on touch start/end. */
  setVirtualButton(name: string, down: boolean): void {
    if (down) {
      if (!this.isDown(name)) this.pressedQueue.push(name);
      this.virtualDown.add(name);
    } else {
      this.virtualDown.delete(name);
    }
  }

  /** Virtual joystick, x = right, y = forward, each in -1..1. */
  setJoystick(x: number, y: number): void {
    this.joystick = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }

  /** Camera look input in pixels (accumulated until consumed). */
  addLook(dx: number, dy: number): void {
    this.look.x += dx;
    this.look.y += dy;
  }

  consumeLook(): { x: number; y: number } {
    const l = this.look;
    this.look = { x: 0, y: 0 };
    return l;
  }

  isDown(button: string): boolean {
    if (this.virtualDown.has(button)) return true;
    for (const code of this.keysDown) if (buttonsForKey(code).includes(button)) return true;
    return false;
  }

  /** Buttons pressed since the last call (each press reported once). */
  consumePressed(): string[] {
    const q = this.pressedQueue;
    this.pressedQueue = [];
    return q;
  }

  /** Movement axis combining keys and joystick: x = right, y = forward. */
  moveAxis(): { x: number; y: number } {
    let x = this.joystick.x;
    let y = this.joystick.y;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('right')) x += 1;
    if (this.isDown('forward')) y += 1;
    if (this.isDown('back')) y -= 1;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }
}
