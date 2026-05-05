/**
 * Browser Control module
 * Jarvis controls its own Chromium browser instance via Playwright
 * Runs headless (background) so you can work while Jarvis browses
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
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    _page = await _context.newPage();
    await _page.goto('about:blank');

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
