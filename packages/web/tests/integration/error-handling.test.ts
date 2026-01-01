import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';

describe('WebDriver Error Handling', () => {
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
      try {
        await driver.close(session);
      } catch {
        // Session may already be closed
      }
    }
  });

  describe('invalid session handling', () => {
    it('should throw error when navigating with closed session', async () => {
      await driver.close(session);

      await expect(driver.navigate(session, 'about:blank'))
        .rejects.toThrow();

      session = null as any;
    });

    it('should throw error when clicking with no active page', async () => {
      // Manually remove the active page reference
      session.pages.clear();

      await expect(driver.click(session, '#test'))
        .rejects.toThrow('No active page found');
    });

    it('should throw error when typing with no active page', async () => {
      session.pages.clear();

      await expect(driver.type(session, '#test', 'text'))
        .rejects.toThrow('No active page found');
    });

    it('should throw error when taking screenshot with no active page', async () => {
      session.pages.clear();

      await expect(driver.screenshot(session))
        .rejects.toThrow('No active page found');
    });
  });

  describe('invalid selector handling', () => {
    it('should throw error for invalid CSS selector in click', async () => {
      await driver.navigate(session, 'about:blank');

      // Invalid selector syntax
      await expect(driver.click(session, '[[[invalid'))
        .rejects.toThrow();
    });

    it('should throw error for invalid CSS selector in type', async () => {
      await driver.navigate(session, 'about:blank');

      await expect(driver.type(session, '[[[invalid', 'text'))
        .rejects.toThrow();
    });
  });

  describe('JavaScript evaluation errors', () => {
    it('should throw error for syntax errors', async () => {
      await driver.navigate(session, 'about:blank');

      await expect(driver.evaluate(session, 'const x = {'))
        .rejects.toThrow();
    });

    it('should throw error for undefined variable access', async () => {
      await driver.navigate(session, 'about:blank');

      await expect(driver.evaluate(session, 'nonExistentVar.property'))
        .rejects.toThrow();
    });

    it('should propagate thrown errors from script', async () => {
      await driver.navigate(session, 'about:blank');

      await expect(driver.evaluate(session, 'throw new Error("custom error")'))
        .rejects.toThrow('custom error');
    });
  });

  describe('tab management errors', () => {
    it('should throw error when selecting non-existent tab', async () => {
      await expect(driver.selectTab(session, 'non-existent-id'))
        .rejects.toThrow('Tab not found');
    });

    it('should throw error when closing non-existent tab', async () => {
      await expect(driver.closeTab(session, 'non-existent-id'))
        .rejects.toThrow('Tab not found');
    });

    it('should throw error when closing the only tab', async () => {
      const tabs = await driver.listTabs(session);
      expect(tabs.length).toBe(1);

      await expect(driver.closeTab(session, tabs[0].id))
        .rejects.toThrow('Cannot close the last tab');
    });
  });

  describe('scroll errors', () => {
    it('should handle scroll on empty page without error', async () => {
      await driver.navigate(session, 'about:blank');

      // Should not throw even on empty page
      await driver.scroll(session, 'down', 100);
      await driver.scrollToTop(session);
      await driver.scrollToBottom(session);
    });

    it('should handle scrollToElement with non-existent selector', async () => {
      await driver.navigate(session, 'about:blank');

      // scrollToElement uses querySelector which returns null for non-existent elements
      // This should not throw, just do nothing
      await driver.scrollToElement(session, '#non-existent');
    });
  });

});
