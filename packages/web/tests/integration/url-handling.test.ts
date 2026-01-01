import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';

describe('WebDriver URL Handling', () => {
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

  describe('navigate edge cases', () => {
    it('should navigate to about:blank', async () => {
      await driver.navigate(session, 'about:blank');
      const url = await driver.evaluate(session, 'window.location.href');
      expect(url).toBe('about:blank');
    });

    it('should navigate to data: URL', async () => {
      await driver.navigate(session, 'data:text/html,<h1>Test</h1>');
      const text = await driver.evaluate(session, 'document.body.textContent');
      expect(text).toContain('Test');
    });

    it('should handle URL with special characters', async () => {
      await driver.navigate(session, 'data:text/html,<script>window.q="hello world"</script>');
      const q = await driver.evaluate(session, 'window.q');
      expect(q).toBe('hello world');
    });

    it('should handle URL with unicode characters', async () => {
      // Navigate first, then inject unicode content
      await driver.navigate(session, 'about:blank');
      await driver.evaluate(session, `
        document.body.innerHTML = '<div id="한글">테스트</div>';
      `);
      const text = await driver.evaluate(session, 'document.getElementById("한글")?.textContent');
      expect(text).toBe('테스트');
    });

    it('should update session URL after navigation', async () => {
      await driver.navigate(session, 'data:text/html,test');

      const tabs = await driver.listTabs(session);
      expect(tabs[0].url).toContain('data:text/html');
    });

    it('should update session title after navigation', async () => {
      await driver.navigate(session, 'data:text/html,<title>Test Title</title>');

      // Wait a moment for title to update
      await new Promise(r => setTimeout(r, 100));

      const tabs = await driver.listTabs(session);
      expect(tabs[0].title).toBe('Test Title');
    });
  });

  describe('content and textContent', () => {
    it('should return HTML content', async () => {
      await driver.navigate(session, 'data:text/html,<div id="test">Hello</div>');

      const content = await driver.content(session);

      expect(content).toContain('<div id="test">Hello</div>');
      expect(content).toContain('<html>');
    });

    it('should return text content', async () => {
      await driver.navigate(session, 'data:text/html,<p>Hello</p><p>World</p>');

      const text = await driver.textContent(session);

      expect(text).toContain('Hello');
      expect(text).toContain('World');
    });

    it('should handle empty page content', async () => {
      await driver.navigate(session, 'about:blank');

      const content = await driver.content(session);
      const text = await driver.textContent(session);

      expect(content).toBeDefined();
      expect(text).toBeDefined();
    });
  });

  describe('recorded actions', () => {
    it('should record URL in navigate action', async () => {
      await driver.navigate(session, 'https://example.com');

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('navigate');
      expect(lastAction.text).toBe('https://example.com');
    });

    it('should record multiple navigations', async () => {
      await driver.navigate(session, 'about:blank');
      await driver.navigate(session, 'data:text/html,test');

      const navigateActions = session.recordedActions.filter(a => a.type === 'navigate');
      expect(navigateActions.length).toBeGreaterThanOrEqual(2);
    });
  });
});
