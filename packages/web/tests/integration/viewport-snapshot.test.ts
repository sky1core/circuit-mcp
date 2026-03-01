import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';

describe('WebDriver Viewport and Snapshot', () => {
  let driver: WebDriver;
  let session: WebSession;

  beforeAll(() => {
    driver = new WebDriver();
  });

  beforeEach(async () => {
    session = await driver.launch({
      browser: 'chromium',
      headed: false,
    });
    await driver.navigate(session, 'about:blank');
  });

  afterEach(async () => {
    if (session) {
      await driver.close(session);
    }
  });

  describe('resize', () => {
    it('should resize viewport to specified dimensions', async () => {
      await driver.resize(session, 800, 600);

      const viewportSize = await driver.evaluate(session, `
        return { width: window.innerWidth, height: window.innerHeight };
      `);

      expect(viewportSize.width).toBe(800);
      expect(viewportSize.height).toBe(600);
    });

    it('should record resize action', async () => {
      await driver.resize(session, 1024, 768);

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('resize');
      expect(lastAction.text).toBe('1024x768');
    });

    it('should handle very small viewport', async () => {
      await driver.resize(session, 320, 480);

      const viewportSize = await driver.evaluate(session, `
        return { width: window.innerWidth, height: window.innerHeight };
      `);

      expect(viewportSize.width).toBe(320);
      expect(viewportSize.height).toBe(480);
    });

    it('should handle large viewport', async () => {
      await driver.resize(session, 1920, 1080);

      const viewportSize = await driver.evaluate(session, `
        return { width: window.innerWidth, height: window.innerHeight };
      `);

      expect(viewportSize.width).toBe(1920);
      expect(viewportSize.height).toBe(1080);
    });
  });

  describe('snapshot (accessibility tree)', () => {
    it('should return accessibility snapshot as JSON', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<h1>Hello World</h1><button>Click me</button>';
      `);

      const snapshot = await driver.snapshot(session);

      expect(snapshot).toBeDefined();
      const parsed = JSON.parse(snapshot);
      expect(parsed).toBeDefined();
    });

    it('should include element refs in snapshot', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<button>Test Button</button>';
      `);

      const snapshot = await driver.snapshot(session);
      const parsed = JSON.parse(snapshot);

      // Check that refs are added to nodes
      const hasRefs = JSON.stringify(parsed).includes('"ref"');
      expect(hasRefs).toBe(true);
    });

    it('should store element refs in pageInfo', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<button>Test</button><a href="#">Link</a>';
      `);

      await driver.snapshot(session);

      const pageInfo = session.pages.get(session.activePage);
      expect(pageInfo?.elementRefs).toBeDefined();
      expect(pageInfo!.elementRefs!.size).toBeGreaterThan(0);
    });

    it('should clear element refs on new navigation', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<button>Test</button>';
      `);
      await driver.snapshot(session);

      const pageInfo = session.pages.get(session.activePage);
      const refsBeforeNav = pageInfo!.elementRefs!.size;

      // Navigate to trigger ref clearing
      await driver.navigate(session, 'about:blank');

      expect(pageInfo!.elementRefs!.size).toBe(0);
    });
  });

  describe('screenshot', () => {
    it('should take screenshot and return path', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<h1 style="color: red;">Test Page</h1>';
        document.body.style.background = 'white';
      `);

      const path = await driver.screenshot(session);

      expect(path).toBeDefined();
      expect(path).toContain('screenshot');
    });

    it('should use JPEG format by default for compression', async () => {
      const path = await driver.screenshot(session);

      expect(path).toContain('.jpeg');
    });

    it('should use custom path when provided', async () => {
      const customPath = '/tmp/test-screenshot.jpeg';
      const path = await driver.screenshot(session, customPath);

      expect(path).toBe(customPath);
    });
  });

  describe('pdf', () => {
    it('should generate PDF and return path', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<h1>PDF Test</h1><p>Some content</p>';
      `);

      const path = await driver.pdf(session);

      expect(path).toBeDefined();
      expect(path).toContain('.pdf');
    });

    it('should use custom path when provided', async () => {
      const customPath = '/tmp/test-document.pdf';
      const path = await driver.pdf(session, customPath);

      expect(path).toBe(customPath);
    });
  });
});
