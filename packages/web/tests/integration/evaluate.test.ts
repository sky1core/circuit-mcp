import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';

describe('WebDriver.evaluate', () => {
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

  describe('basic expressions', () => {
    it('should evaluate simple expressions', async () => {
      const result = await driver.evaluate(session, '1 + 1');
      expect(result).toBe(2);
    });

    it('should evaluate string expressions', async () => {
      const result = await driver.evaluate(session, '"hello" + " " + "world"');
      expect(result).toBe('hello world');
    });

    it('should evaluate object literals', async () => {
      const result = await driver.evaluate(session, '({ a: 1, b: 2 })');
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should evaluate array literals', async () => {
      const result = await driver.evaluate(session, '[1, 2, 3]');
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('return statements', () => {
    it('should handle "return value"', async () => {
      const result = await driver.evaluate(session, 'return 42');
      expect(result).toBe(42);
    });

    it('should handle "return;" (no value)', async () => {
      const result = await driver.evaluate(session, 'return;');
      expect(result).toBeUndefined();
    });

    it('should handle "return" at end without semicolon', async () => {
      const result = await driver.evaluate(session, 'const x = 5; return x');
      expect(result).toBe(5);
    });

    it('should handle multiline with return', async () => {
      const script = `
        const a = 10;
        const b = 20;
        return a + b;
      `;
      const result = await driver.evaluate(session, script);
      expect(result).toBe(30);
    });
  });

  describe('arrow functions in script', () => {
    it('should handle script with arrow function AND return', async () => {
      // This tests the bug: arrow function presence shouldn't prevent return handling
      const script = 'const fn = () => 1; return fn() + 1';
      const result = await driver.evaluate(session, script);
      expect(result).toBe(2);
    });

    it('should handle arrow function result directly', async () => {
      const result = await driver.evaluate(session, '(() => 42)()');
      expect(result).toBe(42);
    });
  });

  describe('IIFE patterns', () => {
    it('should handle IIFE with return', async () => {
      const result = await driver.evaluate(session, '(function() { return 99; })()');
      expect(result).toBe(99);
    });

    it('should handle IIFE followed by return', async () => {
      // This is tricky: starts with '(' but has return outside
      const script = '(function() {})(); return 123';
      const result = await driver.evaluate(session, script);
      expect(result).toBe(123);
    });
  });

  describe('DOM access', () => {
    it('should access document properties', async () => {
      const result = await driver.evaluate(session, 'document.title');
      expect(typeof result).toBe('string');
    });

    it('should access window properties', async () => {
      const result = await driver.evaluate(session, 'window.location.href');
      expect(result).toBe('about:blank');
    });

    it('should execute DOM manipulation', async () => {
      await driver.evaluate(session, 'document.title = "Test Title"');
      const title = await driver.evaluate(session, 'document.title');
      expect(title).toBe('Test Title');
    });
  });

  describe('error handling', () => {
    it('should throw on syntax error', async () => {
      await expect(driver.evaluate(session, 'const x = {')).rejects.toThrow();
    });

    it('should throw on runtime error', async () => {
      await expect(driver.evaluate(session, 'nonExistentVariable.foo')).rejects.toThrow();
    });

    it('should include error details in message', async () => {
      try {
        await driver.evaluate(session, 'throw new Error("custom error")');
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('custom error');
      }
    });
  });

  describe('async evaluation', () => {
    it('should handle promises', async () => {
      const result = await driver.evaluate(session, 'Promise.resolve(42)');
      expect(result).toBe(42);
    });

    it('should handle async/await', async () => {
      const script = `
        (async () => {
          const val = await Promise.resolve(100);
          return val * 2;
        })()
      `;
      const result = await driver.evaluate(session, script);
      expect(result).toBe(200);
    });
  });
});
