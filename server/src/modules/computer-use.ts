/**
 * Computer Use module
 * Gives Jarvis its own independent mouse cursor and keyboard
 * Uses @nut-tree-fork/nut-js (actively maintained macOS arm64 fork)
 * Jarvis can use the computer while you continue working
 */

export interface MousePosition { x: number; y: number; }
export interface ScreenSize { width: number; height: number; }

export interface ComputerUseCapabilities {
  available: boolean;
  screenSize?: ScreenSize;
  reason?: string;
}

// Lazy-load nut-js so server starts even if it fails
let _nut: typeof import('@nut-tree-fork/nut-js') | null = null;
let _nutError: string | null = null;

async function getNut() {
  if (_nut) return _nut;
  if (_nutError) throw new Error(_nutError);
  try {
    _nut = await import('@nut-tree-fork/nut-js');
    // Configure: smooth movement, reasonable speed
    _nut.mouse.config.mouseSpeed = 1500; // pixels/sec
    _nut.keyboard.config.autoDelayMs = 30;
    return _nut;
  } catch (e) {
    _nutError = `nut-js unavailable: ${e}`;
    throw new Error(_nutError);
  }
}

export async function checkAvailable(): Promise<ComputerUseCapabilities> {
  try {
    const nut = await getNut();
    const size = await nut.screen.width();
    const height = await nut.screen.height();
    return { available: true, screenSize: { width: size, height } };
  } catch (e) {
    return { available: false, reason: String(e) };
  }
}

export async function getMousePosition(): Promise<MousePosition> {
  const nut = await getNut();
  const pos = await nut.mouse.getPosition();
  return { x: pos.x, y: pos.y };
}

export async function moveMouse(x: number, y: number): Promise<void> {
  const nut = await getNut();
  await nut.mouse.move(nut.straightTo(nut.centerOf(Promise.resolve(new nut.Region(x, y, 1, 1)))));
}

export async function moveMouseSmooth(x: number, y: number): Promise<void> {
  const nut = await getNut();
  // Smooth curve movement
  const current = await nut.mouse.getPosition();
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease in-out
    await nut.mouse.move(nut.straightTo(nut.centerOf(Promise.resolve(new nut.Region(
      Math.round(current.x + (x - current.x) * ease),
      Math.round(current.y + (y - current.y) * ease),
      1, 1
    )))));
    await sleep(16);
  }
}

export async function click(x: number, y: number, button: 'left' | 'right' | 'double' = 'left'): Promise<void> {
  const nut = await getNut();
  await moveMouseSmooth(x, y);
  await sleep(80);
  if (button === 'double') {
    await nut.mouse.doubleClick(nut.Button.LEFT);
  } else {
    await nut.mouse.click(button === 'right' ? nut.Button.RIGHT : nut.Button.LEFT);
  }
}

export async function typeText(text: string): Promise<void> {
  const nut = await getNut();
  await nut.keyboard.type(text);
}

export async function pressKey(key: string): Promise<void> {
  const nut = await getNut();
  const keyMap: Record<string, unknown> = {
    enter: nut.Key.Return,
    escape: nut.Key.Escape,
    tab: nut.Key.Tab,
    space: nut.Key.Space,
    backspace: nut.Key.Backspace,
    delete: nut.Key.Delete,
    up: nut.Key.Up,
    down: nut.Key.Down,
    left: nut.Key.Left,
    right: nut.Key.Right,
    cmd: nut.Key.LeftCmd,
    ctrl: nut.Key.LeftControl,
    alt: nut.Key.LeftAlt,
    shift: nut.Key.LeftShift,
    f1: nut.Key.F1, f2: nut.Key.F2, f3: nut.Key.F3, f4: nut.Key.F4,
  };
  const mapped = keyMap[key.toLowerCase()];
  if (mapped) {
    await nut.keyboard.pressKey(mapped as never);
    await nut.keyboard.releaseKey(mapped as never);
  }
}

export async function hotkey(...keys: string[]): Promise<void> {
  const nut = await getNut();
  const keyMap: Record<string, unknown> = {
    cmd: nut.Key.LeftCmd, ctrl: nut.Key.LeftControl,
    alt: nut.Key.LeftAlt, shift: nut.Key.LeftShift,
    c: nut.Key.C, v: nut.Key.V, a: nut.Key.A,
    z: nut.Key.Z, s: nut.Key.S, w: nut.Key.W,
    q: nut.Key.Q, t: nut.Key.T, n: nut.Key.N,
    space: nut.Key.Space, enter: nut.Key.Return,
  };
  const mapped = keys.map((k) => keyMap[k.toLowerCase()]).filter(Boolean);
  if (mapped.length) {
    await nut.keyboard.pressKey(...(mapped as never[]));
    await nut.keyboard.releaseKey(...(mapped as never[]));
  }
}

export async function scroll(x: number, y: number, direction: 'up' | 'down', amount = 3): Promise<void> {
  const nut = await getNut();
  await moveMouseSmooth(x, y);
  await nut.mouse.scrollDown(direction === 'down' ? amount : -amount);
}

export async function takeScreenshot(): Promise<Buffer | null> {
  try {
    const { execSync } = await import('child_process');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { readFileSync, unlinkSync } = await import('fs');
    const file = join(tmpdir(), `jarvis-screen-${Date.now()}.png`);
    execSync(`screencapture -x "${file}"`, { timeout: 5000 });
    const buf = readFileSync(file);
    unlinkSync(file);
    return buf;
  } catch {
    return null;
  }
}

export async function getScreenSize(): Promise<ScreenSize> {
  try {
    const nut = await getNut();
    return { width: await nut.screen.width(), height: await nut.screen.height() };
  } catch {
    return { width: 1920, height: 1080 };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
