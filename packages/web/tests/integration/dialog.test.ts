import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';

describe('WebDriver Dialog Handling', () => {
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

  describe('alert handling', () => {
    it('should dismiss alert by default', async () => {
      // Default behavior is dismiss
      const result = await driver.evaluate(session, `
        let dismissed = false;
        window.alert('test');
        dismissed = true;
        return dismissed;
      `);
      expect(result).toBe(true);
    });

    it('should accept alert when configured', async () => {
      await driver.handleDialog(session, 'accept');

      const result = await driver.evaluate(session, `
        let accepted = false;
        window.alert('test');
        accepted = true;
        return accepted;
      `);
      expect(result).toBe(true);
    });
  });

  describe('confirm handling', () => {
    it('should return false when dismissed', async () => {
      await driver.handleDialog(session, 'dismiss');

      const result = await driver.evaluate(session, `
        return window.confirm('Are you sure?');
      `);
      expect(result).toBe(false);
    });

    it('should return true when accepted', async () => {
      await driver.handleDialog(session, 'accept');

      const result = await driver.evaluate(session, `
        return window.confirm('Are you sure?');
      `);
      expect(result).toBe(true);
    });
  });

  describe('prompt handling', () => {
    it('should return null when dismissed', async () => {
      await driver.handleDialog(session, 'dismiss');

      const result = await driver.evaluate(session, `
        return window.prompt('Enter value:');
      `);
      expect(result).toBe(null);
    });

    it('should return empty string when accepted without text', async () => {
      await driver.handleDialog(session, 'accept');

      const result = await driver.evaluate(session, `
        return window.prompt('Enter value:');
      `);
      expect(result).toBe('');
    });

    it('should return provided text when accepted with promptText', async () => {
      await driver.handleDialog(session, 'accept', 'my answer');

      const result = await driver.evaluate(session, `
        return window.prompt('Enter value:');
      `);
      expect(result).toBe('my answer');
    });
  });
});
