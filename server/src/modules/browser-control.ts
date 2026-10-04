/**
 * Browser Control module
 * Jarvis controls its own Chromium browser instance via Playwright
 * Runs headless (background) so you can work while Jarvis browses
 *
 * It also keeps two extra pieces of state that the HUD's live browser view
 * needs and Playwright doesn't expose:
 *   1. the last known mouse position (Playwright's mouse is write-only), and
 *   2. which page is currently "active", with a listener hook so the
 *      screencast in browser-stream.ts can follow Jarvis from tab to tab.
 */
import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
let _page: Page | null = null;
let _initializing = false;

const VIEWPORT = { width: 1280, height: 800 };

// ── Cursor tracking ────────────────────────────────────────────────
export interface CursorState {
  x: number;
  y: number;
  /** epoch ms of the last click, 0 if never */
  lastClickAt: number;
}

const _cursor: CursorState = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2, lastClickAt: 0 };

export function getCursor(): CursorState {
  return { ..._cursor };
}

/**
 * Record where the mouse ended up (and whether that was a click).
 * Coordinates are clamped to the viewport: an element measured mid-navigation
 * can report a box above the fold, and the HUD reticle must stay on screen.
 */
export function recordCursor(x: number, y: number, click = false): void {
  if (Number.isFinite(x)) _cursor.x = Math.max(0, Math.min(VIEWPORT.width, x));
  if (Number.isFinite(y)) _cursor.y = Math.max(0, Math.min(VIEWPORT.height, y));
  if (click) _cursor.lastClickAt = Date.now();
}

export function getViewport(): { width: number; height: number } {
  return { ...VIEWPORT };
}

/** Best-effort: where is this selector's centre, in viewport pixels? */
async function selectorCentre(page: Page, selector: string): Promise<{ x: number; y: number } | null> {
  try {
    const box = await page.locator(selector).first().boundingBox({ timeout: 2000 });
    if (!box) return null;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  } catch {
    // Element gone / detached — cursor stays where it was.
    return null;
  }
}

/** Park the virtual cursor over a selector's centre. Returns where it went. */
async function cursorToSelector(page: Page, selector: string, click: boolean): Promise<{ x: number; y: number } | null> {
  const pos = await selectorCentre(page, selector);
  if (pos) recordCursor(pos.x, pos.y, click);
  return pos;
}

// ── Active page tracking ───────────────────────────────────────────
export type ActivePageListener = (page: Page | null) => void;
const _pageListeners = new Set<ActivePageListener>();

/** Subscribe to active-page changes. Returns an unsubscribe fn. */
export function onActivePageChange(listener: ActivePageListener): () => void {
  _pageListeners.add(listener);
  return () => _pageListeners.delete(listener);
}

function setActivePage(page: Page | null): void {
  if (_page === page) return;
  _page = page;
  for (const l of [..._pageListeners]) {
    try { l(page); } catch { /* listener errors are not our problem */ }
  }
}

/** The current page WITHOUT launching a browser. null = no session yet. */
export function getActivePage(): Page | null {
  if (!_page || _page.isClosed()) return null;
  return _page;
}

export function isRunning(): boolean {
  return !!_browser && !!getActivePage();
}

export async function getBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  if (_browser && _page && !_page.isClosed() && !_initializing) {
    return { browser: _browser, context: _context!, page: _page };
  }

  if (_initializing) {
    await new Promise((r) => setTimeout(r, 500));
    return getBrowser();
  }

  _initializing = true;
  try {
    if (_browser && _context && (!_page || _page.isClosed())) {
      // Browser alive but the page went away — just make a fresh one.
      const page = await _context.newPage();
      setActivePage(page);
      return { browser: _browser, context: _context, page };
    }

    _browser = await chromium.launch({
      headless: true,
      channel: undefined, // Use bundled Chromium, not system Chrome
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
      ],
    });

    _context = await _browser.newContext({
      viewport: { ...VIEWPORT },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // Popups / target=_blank become the active page so the stream follows.
    _context.on('page', (p) => {
      setActivePage(p);
      p.on('close', () => {
        if (_page === p) {
          const remaining = _context?.pages().filter((q) => !q.isClosed()) ?? [];
          setActivePage(remaining.length > 0 ? remaining[remaining.length - 1]! : null);
        }
      });
    });

    const page = await _context.newPage();
    setActivePage(page);
    await page.goto('about:blank');

    _browser.on('disconnected', () => {
      _browser = null;
      _context = null;
      setActivePage(null);
    });

    return { browser: _browser, context: _context, page };
  } finally {
    _initializing = false;
  }
}

export async function navigate(url: string): Promise<{ title: string; url: string }> {
  const { page } = await getBrowser();
  if (!url.startsWith('http')) url = `https://${url}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return { title: await page.title(), url: page.url() };
}

export async function getPageContent(): Promise<string> {
  const { page } = await getBrowser();
  return await page.evaluate(() => document.body?.innerText?.slice(0, 8000) ?? '');
}

export async function clickElement(selector: string): Promise<void> {
  const { page } = await getBrowser();
  const pos = await cursorToSelector(page, selector, false);
  await page.click(selector, { timeout: 10000 });
  // Pulse at the pre-click position: re-measuring after the click can land on
  // a freshly navigated page where the element sits somewhere else entirely.
  const at = pos ?? getCursor();
  recordCursor(at.x, at.y, true);
}

export async function fillInput(selector: string, value: string): Promise<void> {
  const { page } = await getBrowser();
  await cursorToSelector(page, selector, false);
  await page.fill(selector, value);
}

export async function typeInto(selector: string, text: string): Promise<void> {
  const { page } = await getBrowser();
  await cursorToSelector(page, selector, true);
  await page.click(selector);
  await page.type(selector, text, { delay: 50 });
}

export async function screenshot(): Promise<Buffer> {
  const { page } = await getBrowser();
  return await page.screenshot({ type: 'jpeg', quality: 70 });
}

export async function screenshotBase64(): Promise<string> {
  const buf = await screenshot();
  return buf.toString('base64');
}

export async function evaluate(script: string): Promise<unknown> {
  const { page } = await getBrowser();
  return await page.evaluate(script);
}

export async function searchGoogle(query: string): Promise<string> {
  const { page } = await getBrowser();
  await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  // Extract search results
  const results = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('h3')).slice(0, 5);
    const snippets = Array.from(document.querySelectorAll('.VwiC3b')).slice(0, 5);
    return items.map((h, i) => `${h.textContent}\n${snippets[i]?.textContent ?? ''}`).join('\n\n');
  });
  return results || 'No results extracted';
}

export async function closeBrowser(): Promise<void> {
  await _browser?.close();
  _browser = null;
  _context = null;
  setActivePage(null);
}

export async function getStatus(): Promise<{ open: boolean; url?: string; title?: string }> {
  const page = getActivePage();
  if (!page) return { open: false };
  try {
    return { open: true, url: page.url(), title: await page.title() };
  } catch {
    return { open: false };
  }
}

export async function newTab(url?: string): Promise<void> {
  const { context } = await getBrowser();
  setActivePage(await context.newPage());
  if (url) await navigate(url);
}

// ── Remote (HUD) input dispatch ────────────────────────────────────
// Used by the live browser view when the operator flips "control" on.
// All coordinates are page pixels inside the 1280x800 viewport.

export async function remoteMove(x: number, y: number): Promise<void> {
  const page = getActivePage();
  if (!page) return;
  recordCursor(x, y, false);
  await page.mouse.move(x, y);
}

export async function remoteClick(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
  const page = getActivePage();
  if (!page) return;
  recordCursor(x, y, true);
  await page.mouse.click(x, y, { button });
}

export async function remoteScroll(x: number, y: number, deltaY: number, deltaX = 0): Promise<void> {
  const page = getActivePage();
  if (!page) return;
  recordCursor(x, y, false);
  await page.mouse.move(x, y);
  await page.mouse.wheel(deltaX, deltaY);
}

export async function remoteKey(key: string): Promise<void> {
  const page = getActivePage();
  if (!page) return;
  await page.keyboard.press(key);
}

export async function remoteText(text: string): Promise<void> {
  const page = getActivePage();
  if (!page) return;
  await page.keyboard.insertText(text);
}
