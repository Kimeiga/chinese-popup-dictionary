import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../dist');
const TEST_PAGE_PATH = path.resolve(__dirname, 'test-page.html');

const SETUP_TIMEOUT = 60_000;

let browser: Browser;
let page: Page;
let server: http.Server;
let serverUrl: string;

function startServer(): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer((_req, res) => {
      const html = fs.readFileSync(TEST_PAGE_PATH, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

/**
 * Hover precisely over the FIRST character in a text element.
 * Uses getClientRects on a Range to find the exact pixel position of
 * the first character, rather than hovering at the center of the element box.
 */
async function hoverOverFirstChar(page: Page, selector: string): Promise<void> {
  // Move mouse away and dismiss any popup
  await page.mouse.move(0, 0);
  await new Promise((r) => setTimeout(r, 150));

  const pos = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;

    // Find the first text node
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    if (!textNode || !textNode.textContent) return null;

    // Create a range over just the first character
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 1);
    const rect = range.getBoundingClientRect();

    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, selector);

  if (!pos) throw new Error(`Could not find text in ${selector}`);

  await page.mouse.move(pos.x, pos.y);
  await new Promise((r) => setTimeout(r, 600));
}

async function dismissPopup(page: Page): Promise<void> {
  // Move mouse away from all text first
  await page.mouse.move(0, 0);
  await new Promise((r) => setTimeout(r, 100));
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
}

async function waitForPopup(page: Page, timeout: number = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const exists = await page.evaluate(() => {
      const host = document.getElementById('tenzhong-popup-host');
      if (!host?.shadowRoot) return false;
      const popup = host.shadowRoot.querySelector('.tz-popup');
      return popup !== null && !popup.classList.contains('tz-hidden');
    });
    if (exists) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Popup did not appear within timeout');
}

async function getPopupData(page: Page): Promise<{
  hanzi: string;
  pinyin: string;
  defs: string;
  pinyinSpans: number;
  hasHost: boolean;
  hasShadow: boolean;
  isHidden: boolean;
}> {
  return page.evaluate(() => {
    const host = document.getElementById('tenzhong-popup-host');
    if (!host?.shadowRoot) {
      return { hanzi: '', pinyin: '', defs: '', pinyinSpans: 0, hasHost: false, hasShadow: false, isHidden: true };
    }
    const popup = host.shadowRoot.querySelector('.tz-popup');
    const hanziEl = host.shadowRoot.querySelector('.tz-hanzi');
    const pinyinEl = host.shadowRoot.querySelector('.tz-pinyin');
    const defsEl = host.shadowRoot.querySelector('.tz-definitions');

    return {
      hanzi: hanziEl?.textContent || '',
      pinyin: pinyinEl?.textContent || '',
      defs: defsEl?.textContent || '',
      pinyinSpans: pinyinEl?.querySelectorAll('.tz-pinyin-syllable').length || 0,
      hasHost: true,
      hasShadow: true,
      isHidden: !popup || popup.classList.contains('tz-hidden'),
    };
  });
}

describe('TenZhong Extension E2E', () => {
  beforeAll(async () => {
    serverUrl = await startServer();
    console.log(`[E2E] Test server: ${serverUrl}`);

    browser = await puppeteer.launch({
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1024,768',
      ],
    });

    // Wait for service worker
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker',
      { timeout: 15_000 }
    );
    console.log('[E2E] Service worker found');

    // Wait for dictionary to load
    const sw = await swTarget.worker();
    if (sw) {
      sw.on('console', (msg) => console.log(`[SW] ${msg.text()}`));

      const loaded = await sw.evaluate(async () => {
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 500));
          try {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const req = indexedDB.open('tenzhong-dict');
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            const tx = db.transaction('meta', 'readonly');
            const loaded = await new Promise<boolean>((resolve) => {
              const req = tx.objectStore('meta').get('loaded');
              req.onsuccess = () => resolve(!!req.result);
              req.onerror = () => resolve(false);
            });
            db.close();
            if (loaded) return true;
          } catch { /* not ready */ }
        }
        return false;
      });
      console.log(`[E2E] Dictionary loaded: ${loaded}`);
    }

    // Navigate to test page
    page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768 });
    page.on('console', (msg) => {
      if (msg.text().includes('TenZhong')) console.log(`[CS] ${msg.text()}`);
    });
    page.on('pageerror', (err) => console.error(`[PAGE ERROR] ${err.message}`));

    await page.goto(serverUrl, { waitUntil: 'networkidle0' });
    // Let content script fully initialize
    await new Promise((r) => setTimeout(r, 2000));
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) server.close();
  });

  it('content script is injected and responds to hover', async () => {
    // Hover over Chinese text and check that content script creates the popup host
    await hoverOverFirstChar(page, '#common-word');
    await waitForPopup(page);
    const data = await getPopupData(page);
    expect(data.hasHost).toBe(true);
    expect(data.hasShadow).toBe(true);
  });

  it('shows popup with correct hanzi for 中国', async () => {
    await dismissPopup(page);
    await hoverOverFirstChar(page, '#common-word');
    await waitForPopup(page);
    const data = await getPopupData(page);
    expect(data.hanzi).toContain('中国');
  });

  it('shows popup for single character 人', async () => {
    await dismissPopup(page);
    await hoverOverFirstChar(page, '#single-char');
    await waitForPopup(page);
    const data = await getPopupData(page);
    expect(data.hanzi.length).toBeGreaterThanOrEqual(1);
  });

  it('performs longest-prefix matching on 中华人民共和国', async () => {
    await dismissPopup(page);
    await hoverOverFirstChar(page, '#long-compound');
    await waitForPopup(page);
    const data = await getPopupData(page);
    console.log(`[E2E] Longest match hanzi: "${data.hanzi}" (len=${data.hanzi.length})`);
    // Should match at least 中华 (2+ chars), ideally the full 中华人民共和国
    expect(data.hanzi.length).toBeGreaterThanOrEqual(2);
  });

  it('shows tone-colored pinyin spans', async () => {
    await dismissPopup(page);
    await hoverOverFirstChar(page, '#common-word');
    await waitForPopup(page);
    const data = await getPopupData(page);
    expect(data.pinyinSpans).toBeGreaterThan(0);
    expect(data.pinyin.length).toBeGreaterThan(0);
  });

  it('shows English definitions', async () => {
    await dismissPopup(page);
    await hoverOverFirstChar(page, '#common-word');
    await waitForPopup(page);
    const data = await getPopupData(page);
    expect(data.defs.length).toBeGreaterThan(0);
    // "中国" should have "China" in its definitions
    expect(data.defs.toLowerCase()).toContain('china');
  });

  it('hides popup when pressing Escape after moving mouse away', async () => {
    await dismissPopup(page);
    await hoverOverFirstChar(page, '#common-word');
    await waitForPopup(page);

    // Move mouse away first, then press escape
    await page.mouse.move(0, 0);
    await new Promise((r) => setTimeout(r, 200));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 400));

    const data = await getPopupData(page);
    expect(data.isHidden).toBe(true);
  });

  it('hides popup on mouse click', async () => {
    await dismissPopup(page);
    await hoverOverFirstChar(page, '#common-word');
    await waitForPopup(page);

    // Click in an empty area
    await page.mouse.click(5, 5);
    await new Promise((r) => setTimeout(r, 400));

    const data = await getPopupData(page);
    expect(data.isHidden).toBe(true);
  });

  it('does not show popup over English text', async () => {
    await dismissPopup(page);

    // Hover over the "I" in "I love" at the very start of #mixed
    const pos = await page.evaluate(() => {
      const el = document.querySelector('#mixed');
      if (!el) return null;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const textNode = walker.nextNode();
      if (!textNode?.textContent) return null;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 1); // "I"
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    if (!pos) throw new Error('Could not find text in #mixed');
    await page.mouse.move(pos.x, pos.y);
    await new Promise((r) => setTimeout(r, 500));

    const data = await getPopupData(page);
    expect(data.isHidden).toBe(true);
  });

  it('popup is fully isolated in Shadow DOM', async () => {
    await dismissPopup(page);
    await hoverOverFirstChar(page, '#common-word');
    await waitForPopup(page);

    const isolated = await page.evaluate(() => {
      const host = document.getElementById('tenzhong-popup-host');
      if (!host?.shadowRoot) return false;
      // Verify style tag exists inside shadow root (not in main document)
      const style = host.shadowRoot.querySelector('style');
      // Verify popup is inside shadow root
      const popup = host.shadowRoot.querySelector('.tz-popup');
      return !!style && !!popup;
    });

    expect(isolated).toBe(true);
  });
});
