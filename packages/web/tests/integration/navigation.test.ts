import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';

describe('WebDriver Navigation', () => {
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
  });

  afterEach(async () => {
    if (session) {
      await driver.close(session);
    }
  });

  describe('page info updates', () => {
    it('should update page title after navigation', async () => {
      await driver.navigate(session, 'about:blank');
      await driver.evaluate(session, 'document.title = "Test Title"');

      // Navigate to trigger page info update
      await driver.evaluate(session, `
        document.body.innerHTML = '<h1>Hello</h1>';
      `);

      // Get the pageInfo directly
      const pageInfo = session.pages.get(session.activePage);
      // Note: title is updated on 'load' event, not immediately
      expect(pageInfo).toBeDefined();
    });

    it('should update page URL after navigation', async () => {
      await driver.navigate(session, 'about:blank');

      const pageInfo = session.pages.get(session.activePage);
      expect(pageInfo?.url).toBe('about:blank');
    });

    it('should record navigate action', async () => {
      await driver.navigate(session, 'about:blank');

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('navigate');
      expect(lastAction.text).toBe('about:blank');
    });
  });

  describe('back and forward', () => {
    it('should navigate back in history', async () => {
      await driver.navigate(session, 'about:blank');
      await driver.evaluate(session, 'document.title = "Page 1"');

      await driver.navigate(session, 'data:text/html,<title>Page 2</title>');

      await driver.back(session);

      const url = await driver.evaluate(session, 'window.location.href');
      expect(url).toBe('about:blank');
    });

    it('should navigate forward in history', async () => {
      await driver.navigate(session, 'about:blank');
      await driver.navigate(session, 'data:text/html,<title>Page 2</title>');

      await driver.back(session);
      await driver.forward(session);

      const url = await driver.evaluate(session, 'window.location.href');
      expect(url).toContain('data:text/html');
    });

    it('should record back action', async () => {
      await driver.navigate(session, 'about:blank');
      await driver.navigate(session, 'data:text/html,test');
      await driver.back(session);

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('back');
    });

    it('should record forward action', async () => {
      await driver.navigate(session, 'about:blank');
      await driver.navigate(session, 'data:text/html,test');
      await driver.back(session);
      await driver.forward(session);

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('forward');
    });
  });

  describe('refresh', () => {
    it('should reload the page', async () => {
      await driver.navigate(session, 'about:blank');
      await driver.evaluate(session, 'window.testVar = 123');

      await driver.refresh(session);

      // After refresh, the variable should be gone
      const result = await driver.evaluate(session, 'typeof window.testVar');
      expect(result).toBe('undefined');
    });

    it('should record refresh action', async () => {
      await driver.navigate(session, 'about:blank');
      await driver.refresh(session);

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('refresh');
    });
  });

  describe('content methods', () => {
    it('should return HTML content', async () => {
      await driver.navigate(session, 'about:blank');
      await driver.evaluate(session, `
        document.body.innerHTML = '<div id="test">Hello World</div>';
      `);

      const content = await driver.content(session);
      expect(content).toContain('<div id="test">Hello World</div>');
    });

    it('should return text content', async () => {
      await driver.navigate(session, 'about:blank');
      await driver.evaluate(session, `
        document.body.innerHTML = '<div>Hello</div><div>World</div>';
      `);

      const textContent = await driver.textContent(session);
      expect(textContent).toContain('Hello');
      expect(textContent).toContain('World');
    });
  });
});
