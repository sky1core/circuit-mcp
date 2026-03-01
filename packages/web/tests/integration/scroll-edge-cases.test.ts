import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';

describe('WebDriver Scroll Edge Cases', () => {
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
    // Create scrollable page
    await driver.navigate(session, 'about:blank');
    await driver.evaluate(session, `
      document.body.style.height = '3000px';
      document.body.style.width = '3000px';
      document.body.innerHTML = '<div style="position: fixed; top: 10px; left: 10px;">Scroll Test</div>';
    `);
  });

  afterEach(async () => {
    if (session) {
      await driver.close(session);
    }
  });

  describe('scroll direction validation', () => {
    it('should scroll up correctly', async () => {
      // First scroll down
      await driver.scroll(session, 'down', 500);
      const afterDown = await driver.evaluate(session, 'window.scrollY');
      expect(afterDown).toBe(500);

      // Then scroll up
      await driver.scroll(session, 'up', 200);
      const afterUp = await driver.evaluate(session, 'window.scrollY');
      expect(afterUp).toBe(300);
    });

    it('should scroll down correctly', async () => {
      await driver.scroll(session, 'down', 300);
      const scrollY = await driver.evaluate(session, 'window.scrollY');
      expect(scrollY).toBe(300);
    });

    it('should scroll left correctly', async () => {
      // First scroll right
      await driver.scroll(session, 'right', 500);
      const afterRight = await driver.evaluate(session, 'window.scrollX');
      expect(afterRight).toBe(500);

      // Then scroll left
      await driver.scroll(session, 'left', 200);
      const afterLeft = await driver.evaluate(session, 'window.scrollX');
      expect(afterLeft).toBe(300);
    });

    it('should scroll right correctly', async () => {
      await driver.scroll(session, 'right', 300);
      const scrollX = await driver.evaluate(session, 'window.scrollX');
      expect(scrollX).toBe(300);
    });
  });

  describe('scroll amount edge cases', () => {
    it('should use default amount when not specified', async () => {
      await driver.scroll(session, 'down');
      const scrollY = await driver.evaluate(session, 'window.scrollY');
      expect(scrollY).toBe(500); // default amount
    });

    it('should handle zero amount', async () => {
      await driver.scroll(session, 'down', 0);
      const scrollY = await driver.evaluate(session, 'window.scrollY');
      // 0 is falsy so default should be used
      expect(scrollY).toBe(500);
    });

    it('should handle negative amount (scroll opposite direction)', async () => {
      // First scroll down to give us room to scroll up
      await driver.scroll(session, 'down', 500);

      // Negative amount with 'down' should still go down (absolute value behavior)
      await driver.scroll(session, 'down', -100);
      const scrollY = await driver.evaluate(session, 'window.scrollY');
      // With negative value, -100 * 1 = -100, so we scroll up by 100
      // 500 - 100 = 400
      expect(scrollY).toBe(400);
    });

    it('should handle very large amount', async () => {
      await driver.scroll(session, 'down', 1000000);
      const scrollY = await driver.evaluate(session, 'window.scrollY');
      // Should scroll to maximum (page height - viewport height)
      expect(scrollY).toBeGreaterThan(0);
      expect(scrollY).toBeLessThan(1000000); // can't scroll more than page height
    });
  });

  describe('scrollToElement edge cases', () => {
    it('should scroll to existing element', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<div id="target" style="margin-top: 2000px;">Target</div>';
      `);

      await driver.scrollToElement(session, '#target');

      const scrollY = await driver.evaluate(session, 'window.scrollY');
      expect(scrollY).toBeGreaterThan(0);
    });

    it('should handle non-existent element gracefully', async () => {
      // Should not throw
      await driver.scrollToElement(session, '#non-existent');

      // Scroll should remain unchanged
      const scrollY = await driver.evaluate(session, 'window.scrollY');
      expect(scrollY).toBe(0);
    });

    it('should handle selector with special characters', async () => {
      await driver.evaluate(session, `
        const el = document.createElement('div');
        el.id = 'test\\'s-id';
        el.style.marginTop = '2000px';
        el.textContent = 'Target';
        document.body.appendChild(el);
      `);

      // This should not throw
      await driver.scrollToElement(session, "[id=\"test's-id\"]");
    });
  });

  describe('scrollToTop and scrollToBottom', () => {
    it('should scroll to top after scrolling down', async () => {
      await driver.scroll(session, 'down', 1000);
      expect(await driver.evaluate(session, 'window.scrollY')).toBeGreaterThan(0);

      await driver.scrollToTop(session);
      expect(await driver.evaluate(session, 'window.scrollY')).toBe(0);
    });

    it('should scroll to bottom of page', async () => {
      await driver.scrollToBottom(session);

      const scrollY = await driver.evaluate(session, 'window.scrollY');
      const maxScroll = await driver.evaluate(session, 'document.body.scrollHeight - window.innerHeight');

      expect(scrollY).toBeGreaterThan(0);
      // Should be at or near the bottom
      expect(Math.abs(scrollY - maxScroll)).toBeLessThan(10);
    });

    it('should handle scrollToTop on empty/short page', async () => {
      await driver.evaluate(session, `
        document.body.style.height = '100px';
      `);

      // Should not throw
      await driver.scrollToTop(session);
      expect(await driver.evaluate(session, 'window.scrollY')).toBe(0);
    });

    it('should handle scrollToBottom on empty/short page', async () => {
      await driver.evaluate(session, `
        document.body.style.height = '100px';
      `);

      // Should not throw
      await driver.scrollToBottom(session);
      // Scroll position should be 0 or very small since page doesn't need scrolling
      expect(await driver.evaluate(session, 'window.scrollY')).toBe(0);
    });
  });
});
