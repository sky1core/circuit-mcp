import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, '..', 'fixtures', 'test-html');

describe('WebDriver Integration', () => {
  let driver: WebDriver;
  let session: WebSession;

  beforeAll(() => {
    driver = new WebDriver();
  });

  beforeEach(async () => {
    session = await driver.launch({
      browser: 'chromium',
      headed: false,
      viewport: { width: 1280, height: 720 },
    });
  });

  afterEach(async () => {
    if (session) {
      await driver.close(session);
    }
  });

  describe('launch and close', () => {
    it('should launch browser and create session', () => {
      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.browser).toBeDefined();
      expect(session.context).toBeDefined();
      expect(session.pages.size).toBe(1);
    });

    it('should have an active page', () => {
      expect(session.activePage).toBeDefined();
      const pageInfo = session.pages.get(session.activePage);
      expect(pageInfo).toBeDefined();
    });
  });

  describe('navigation', () => {
    it('should navigate to a URL', async () => {
      const testPage = `file://${path.join(fixturesPath, 'scroll-test.html')}`;
      await driver.navigate(session, testPage);

      const pageInfo = session.pages.get(session.activePage);
      expect(pageInfo?.url).toBe(testPage);
    });

    it('should record navigation action', async () => {
      const testPage = `file://${path.join(fixturesPath, 'scroll-test.html')}`;
      await driver.navigate(session, testPage);

      expect(session.recordedActions.length).toBeGreaterThan(0);
      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('navigate');
      expect(lastAction.text).toBe(testPage);
    });
  });

  describe('scroll', () => {
    const testPage = `file://${path.join(fixturesPath, 'scroll-test.html')}`;

    beforeEach(async () => {
      await driver.navigate(session, testPage);
      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    it('should scroll down by exact amount', async () => {
      const before = await driver.evaluate(session, 'window.scrollY') as number;
      await driver.scroll(session, 'down', 500);
      const after = await driver.evaluate(session, 'window.scrollY') as number;

      expect(after - before).toBe(500);
    });

    it('should scroll up by exact amount', async () => {
      // First scroll down
      await driver.scroll(session, 'down', 500);

      const before = await driver.evaluate(session, 'window.scrollY') as number;
      await driver.scroll(session, 'up', 300);
      const after = await driver.evaluate(session, 'window.scrollY') as number;

      expect(before - after).toBe(300);
    });

    it('should scroll to top (scrollY === 0)', async () => {
      // First scroll down
      await driver.scroll(session, 'down', 1000);

      await driver.scrollToTop(session);
      const scrollY = await driver.evaluate(session, 'window.scrollY');

      expect(scrollY).toBe(0);
    });

    it('should scroll to bottom (at document end)', async () => {
      await driver.scrollToBottom(session);

      const isAtBottom = await driver.evaluate(session,
        'Math.ceil(window.scrollY + window.innerHeight) >= document.body.scrollHeight'
      );

      expect(isAtBottom).toBe(true);
    });

    it('should scroll to element (element visible in viewport)', async () => {
      await driver.scrollToElement(session, '#middle-marker');

      // Check if the middle marker is in view
      const isInView = await driver.evaluate(session, `
        const el = document.querySelector('#middle-marker');
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      `);

      expect(isInView).toBe(true);
    });

    it('should use default scroll amount (500px) when not specified', async () => {
      const before = await driver.evaluate(session, 'window.scrollY') as number;
      await driver.scroll(session, 'down'); // No amount specified, should use 500
      const after = await driver.evaluate(session, 'window.scrollY') as number;

      expect(after - before).toBe(500);
    });

    it('should record scroll actions', async () => {
      const initialActions = session.recordedActions.length;
      await driver.scroll(session, 'down', 200);

      expect(session.recordedActions.length).toBe(initialActions + 1);
      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('scroll');
      expect(lastAction.text).toBe('down 200');
    });
  });

  describe('screenshot', () => {
    it('should take a screenshot', async () => {
      const testPage = `file://${path.join(fixturesPath, 'scroll-test.html')}`;
      await driver.navigate(session, testPage);

      const screenshotPath = await driver.screenshot(session);
      expect(screenshotPath).toContain('.jpeg');

      // Clean up
      const fs = await import('fs/promises');
      await fs.unlink(screenshotPath).catch(() => {});
    });
  });

  describe('evaluate', () => {
    it('should execute JavaScript and return result', async () => {
      await driver.navigate(session, 'about:blank');
      const result = await driver.evaluate(session, '1 + 1');
      expect(result).toBe(2);
    });

    it('should access DOM', async () => {
      const testPage = `file://${path.join(fixturesPath, 'scroll-test.html')}`;
      await driver.navigate(session, testPage);

      const title = await driver.evaluate(session, 'document.title');
      expect(title).toBe('Scroll Test Page');
    });

    it('should handle return statements', async () => {
      await driver.navigate(session, 'about:blank');
      const result = await driver.evaluate(session, 'return 42');
      expect(result).toBe(42);
    });
  });

  describe('tab management', () => {
    it('should create a new tab', async () => {
      const initialTabCount = session.pages.size;
      const newTabId = await driver.newTab(session);

      expect(session.pages.size).toBe(initialTabCount + 1);
      expect(session.pages.has(newTabId)).toBe(true);
    });

    it('should list all tabs', async () => {
      await driver.newTab(session);
      await driver.newTab(session);

      const tabs = await driver.listTabs(session);
      expect(tabs.length).toBe(3);

      // Exactly one should be active
      const activeTabs = tabs.filter(t => t.active);
      expect(activeTabs.length).toBe(1);
    });

    it('should switch between tabs', async () => {
      const tab1 = session.activePage;
      const tab2 = await driver.newTab(session);

      await driver.selectTab(session, tab2);
      expect(session.activePage).toBe(tab2);

      await driver.selectTab(session, tab1);
      expect(session.activePage).toBe(tab1);
    });

    it('should close a tab', async () => {
      const tab2 = await driver.newTab(session);
      await driver.selectTab(session, tab2);

      await driver.closeTab(session, tab2);

      expect(session.pages.has(tab2)).toBe(false);
      expect(session.pages.size).toBe(1);
    });

    it('should throw error when closing last tab', async () => {
      const onlyTab = session.activePage;

      await expect(driver.closeTab(session, onlyTab))
        .rejects.toThrow('Cannot close the last tab');
    });
  });

  describe('content extraction', () => {
    it('should get page content (HTML)', async () => {
      const testPage = `file://${path.join(fixturesPath, 'scroll-test.html')}`;
      await driver.navigate(session, testPage);

      const content = await driver.content(session);
      expect(content).toContain('<html');
      expect(content).toContain('Scroll Test Page');
    });

    it('should get text content', async () => {
      const testPage = `file://${path.join(fixturesPath, 'scroll-test.html')}`;
      await driver.navigate(session, testPage);

      const textContent = await driver.textContent(session);
      expect(textContent).toContain('Top Marker');
      expect(textContent).toContain('Middle Marker');
      expect(textContent).toContain('Bottom Marker');
    });

    it('should get accessibility snapshot', async () => {
      const testPage = `file://${path.join(fixturesPath, 'scroll-test.html')}`;
      await driver.navigate(session, testPage);

      const snapshot = await driver.snapshot(session);
      const parsed = JSON.parse(snapshot);

      expect(parsed.role).toBe('WebArea');
    });
  });

  describe('resize', () => {
    it('should resize viewport', async () => {
      await driver.resize(session, 800, 600);

      const pageInfo = session.pages.get(session.activePage);
      const viewportSize = pageInfo!.page.viewportSize();

      expect(viewportSize?.width).toBe(800);
      expect(viewportSize?.height).toBe(600);
    });

    it('should record resize action', async () => {
      const initialActions = session.recordedActions.length;
      await driver.resize(session, 1024, 768);

      expect(session.recordedActions.length).toBe(initialActions + 1);
      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('resize');
      expect(lastAction.text).toBe('1024x768');
    });
  });

  describe('click and type', () => {
    it('should click on elements', async () => {
      const testPage = `file://${path.join(fixturesPath, 'scroll-test.html')}`;
      await driver.navigate(session, testPage);

      // This just verifies the method doesn't throw
      await expect(driver.click(session, '#top-marker')).resolves.not.toThrow();
    });

    it('should record click action', async () => {
      const testPage = `file://${path.join(fixturesPath, 'scroll-test.html')}`;
      await driver.navigate(session, testPage);

      await driver.click(session, '#top-marker');

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('click');
      expect(lastAction.selector).toBe('#top-marker');
    });
  });

  describe('Playwright test generation', () => {
    it('should generate test from recorded actions', async () => {
      const testPage = `file://${path.join(fixturesPath, 'scroll-test.html')}`;
      await driver.navigate(session, testPage);
      await driver.click(session, '#top-marker');
      await driver.scroll(session, 'down', 500);

      const testCode = await driver.generatePlaywrightTest(session);

      expect(testCode).toContain('@playwright/test');
      expect(testCode).toContain('test(');
      expect(testCode).toContain(testPage);
      expect(testCode).toContain('#top-marker');
    });
  });
});
