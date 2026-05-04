/**
 * Browser Control module
 * Jarvis controls its own Chromium browser instance via Playwright
 * Completely independent from your browser — Jarvis sees and acts in its own window
 */
import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
let _page: Page | null = null;
let _initializing = false;

export async function getBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  if (_browser && _page && !_initializing) {
    return { browser: _browser, context: _context!, page: _page };
  }

  if (_initializing) {
    await new Promise((r) => setTimeout(r, 500));
    return getBrowser();
  }

  _initializing = true;
  try {
    _browser = await chromium.launch({
      headless: false, // Jarvis has a VISIBLE browser window
      args: [
        '--no-sandbox',
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
        `--app-name=JARVIS Browser`,
      ],
      slowMo: 50, // Slight delay so actions are visible
    });

    _context = await _browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    _page = await _context.newPage();
    await _page.goto('about:blank');

    // Inject Jarvis watermark into every page
    await _context.addInitScript(() => {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;top:8px;right:8px;background:rgba(0,0,0,0.8);color:#00e5ff;font-family:monospace;font-size:10px;padding:4px 8px;border:1px solid #00e5ff33;border-radius:2px;z-index:99999;pointer-events:none;letter-spacing:0.1em;';
      el.textContent = 'J.A.R.V.I.S. BROWSER';
      document.addEventListener('DOMContentLoaded', () => document.body?.appendChild(el));
    });

    _browser.on('disconnected', () => {
      _browser = null;
      _context = null;
      _page = null;
    });

    return { browser: _browser, context: _context, page: _page };
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
  await page.click(selector, { timeout: 10000 });
}

export async function fillInput(selector: string, value: string): Promise<void> {
  const { page } = await getBrowser();
  await page.fill(selector, value);
}

export async function typeInto(selector: string, text: string): Promise<void> {
  const { page } = await getBrowser();
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
  _page = null;
}

export async function getStatus(): Promise<{ open: boolean; url?: string; title?: string }> {
  if (!_page) return { open: false };
  try {
    return { open: true, url: _page.url(), title: await _page.title() };
  } catch {
    return { open: false };
  }
}

export async function newTab(url?: string): Promise<void> {
  const { context } = await getBrowser();
  _page = await context.newPage();
  if (url) await navigate(url);
}
