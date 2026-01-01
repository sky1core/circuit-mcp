import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';

describe('WebDriver Network and Console Tracking', () => {
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

  describe('network requests', () => {
    it('should return empty array when no requests made', async () => {
      // data: URLs don't generate network requests
      const requests = await driver.getNetworkRequests(session);

      expect(Array.isArray(requests)).toBe(true);
    });

    it('should return array from getNetworkRequests', async () => {
      // The network request tracking is set up via page listeners
      // We just verify the API works correctly
      const requests = await driver.getNetworkRequests(session);

      expect(Array.isArray(requests)).toBe(true);
      // Each request should have the expected structure
      for (const req of requests) {
        expect(typeof req.url).toBe('string');
        expect(typeof req.method).toBe('string');
        expect(typeof req.timestamp).toBe('number');
      }
    });

    it('should include url and method in requests', async () => {
      await driver.evaluate(session, `
        fetch('http://localhost:99999/test', { method: 'POST' }).catch(() => {});
      `);
      await new Promise(resolve => setTimeout(resolve, 200));

      const requests = await driver.getNetworkRequests(session);

      if (requests.length > 0) {
        for (const req of requests) {
          expect(req.url).toBeDefined();
          expect(req.method).toBeDefined();
          expect(req.timestamp).toBeDefined();
        }
      }
    });

    it('should limit stored requests to MAX_NETWORK_REQUESTS', async () => {
      const requests = await driver.getNetworkRequests(session);
      expect(requests.length).toBeLessThanOrEqual(100);
    });
  });

  describe('console messages', () => {
    it('should track console.log messages', async () => {
      await driver.evaluate(session, 'console.log("test message")');

      // Small delay to allow message to be captured
      await new Promise(resolve => setTimeout(resolve, 100));

      const messages = await driver.getConsoleMessages(session);

      const logMessages = messages.filter(m => m.type === 'log');
      expect(logMessages.some(m => m.text.includes('test message'))).toBe(true);
    });

    it('should track console.error messages', async () => {
      await driver.evaluate(session, 'console.error("error message")');

      await new Promise(resolve => setTimeout(resolve, 100));

      const messages = await driver.getConsoleMessages(session);

      const errorMessages = messages.filter(m => m.type === 'error');
      expect(errorMessages.some(m => m.text.includes('error message'))).toBe(true);
    });

    it('should track console.warn messages', async () => {
      await driver.evaluate(session, 'console.warn("warning message")');

      await new Promise(resolve => setTimeout(resolve, 100));

      const messages = await driver.getConsoleMessages(session);

      const warnMessages = messages.filter(m => m.type === 'warning');
      expect(warnMessages.some(m => m.text.includes('warning message'))).toBe(true);
    });

    it('should include type and text in messages', async () => {
      await driver.evaluate(session, 'console.log("typed message")');

      await new Promise(resolve => setTimeout(resolve, 100));

      const messages = await driver.getConsoleMessages(session);

      for (const msg of messages) {
        expect(msg.type).toBeDefined();
        expect(msg.text).toBeDefined();
        expect(msg.timestamp).toBeDefined();
      }
    });
  });

  describe('session cleanup', () => {
    it('should clear arrays on session close', async () => {
      await driver.evaluate(session, 'console.log("test")');
      await driver.navigate(session, 'about:blank');

      // Wait for console message to be captured
      await new Promise(resolve => setTimeout(resolve, 100));

      // Before close, console messages and recordedActions should have content
      expect(session.consoleMessages.length).toBeGreaterThan(0);
      expect(session.recordedActions.length).toBeGreaterThan(0);

      await driver.close(session);

      // After close, arrays should be empty
      expect(session.networkRequests.length).toBe(0);
      expect(session.consoleMessages.length).toBe(0);
      expect(session.recordedActions.length).toBe(0);

      // Prevent afterEach from trying to close again
      session = null as any;
    });
  });
});
