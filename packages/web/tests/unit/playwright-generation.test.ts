import { describe, it, expect } from 'vitest';
import { WebDriver } from '../../src/web-driver.js';

// Access internal session for testing
const driver = new WebDriver() as any;

describe('generatePlaywrightTest', () => {
  describe('action type coverage', () => {
    it('should generate code for navigate action', async () => {
      const session = {
        recordedActions: [{ type: 'navigate', text: 'https://example.com' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain("page.goto('https://example.com')");
    });

    it('should generate code for click action', async () => {
      const session = {
        recordedActions: [{ type: 'click', selector: '#button' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain("page.click('#button')");
    });

    it('should generate code for type action', async () => {
      const session = {
        recordedActions: [{ type: 'type', selector: '#input', text: 'hello' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain("page.fill('#input', 'hello')");
    });

    it('should generate code for key action', async () => {
      const session = {
        recordedActions: [{ type: 'key', text: 'Enter' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain("page.keyboard.press('Enter')");
    });

    it('should generate code for hover action', async () => {
      const session = {
        recordedActions: [{ type: 'hover', selector: '#menu' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain("page.hover('#menu')");
    });

    it('should generate code for select action', async () => {
      const session = {
        recordedActions: [{ type: 'select', selector: '#dropdown', text: 'option1' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain("page.selectOption('#dropdown', 'option1')");
    });

    it('should generate code for drag action', async () => {
      const session = {
        recordedActions: [{ type: 'drag', selector: '#source to #target' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      // drag action should generate dragAndDrop with both selectors
      expect(code).toContain("page.dragAndDrop('#source', '#target')");
    });

    it('should generate code for upload action', async () => {
      const session = {
        recordedActions: [{ type: 'upload', selector: '#fileInput', text: '/path/to/file.txt' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      // upload action should generate setInputFiles
      expect(code).toContain("page.setInputFiles('#fileInput', '/path/to/file.txt')");
    });

    it('should generate code for back action', async () => {
      const session = {
        recordedActions: [{ type: 'back' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain('page.goBack()');
    });

    it('should generate code for forward action', async () => {
      const session = {
        recordedActions: [{ type: 'forward' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain('page.goForward()');
    });

    it('should generate code for refresh action', async () => {
      const session = {
        recordedActions: [{ type: 'refresh' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain('page.reload()');
    });

    it('should generate code for scroll action', async () => {
      const session = {
        recordedActions: [{ type: 'scroll', text: 'down 500' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      // scroll should be generated as a comment or evaluate
      expect(code).toContain('scroll');
    });
  });

  describe('special character escaping', () => {
    it('should escape single quotes in URL', async () => {
      const session = {
        recordedActions: [{ type: 'navigate', text: "https://example.com/path?q='test'" }],
      };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain("\\'test\\'");
      expect(code).not.toContain("'test'");
    });

    it('should escape backslashes in selector', async () => {
      const session = {
        recordedActions: [{ type: 'click', selector: '[data-path="C:\\Users\\test"]' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain('\\\\Users\\\\test');
    });

    it('should escape both backslashes and quotes', async () => {
      const session = {
        recordedActions: [{ type: 'type', selector: '#input', text: "path: 'C:\\test'" }],
      };

      const code = await driver.generatePlaywrightTest(session);

      // Both should be escaped
      expect(code).toContain('\\\\test');
      expect(code).toContain("\\'");
    });

    it('should handle newlines in text', async () => {
      const session = {
        recordedActions: [{ type: 'type', selector: '#textarea', text: 'line1\nline2' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      // Generated code should be valid JavaScript
      expect(code).toBeDefined();
      expect(code).toContain('line1');
      expect(code).toContain('line2');
    });

    it('should handle empty text', async () => {
      const session = {
        recordedActions: [{ type: 'navigate', text: '' }],
      };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain("page.goto('')");
    });

    it('should handle undefined text gracefully', async () => {
      const session = {
        recordedActions: [{ type: 'navigate', text: undefined }],
      };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain("page.goto('')");
    });
  });

  describe('test structure', () => {
    it('should include Playwright test wrapper', async () => {
      const session = { recordedActions: [] };

      const code = await driver.generatePlaywrightTest(session);

      expect(code).toContain("const { test, expect } = require('@playwright/test')");
      expect(code).toContain("test('Generated test'");
      expect(code).toContain('async ({ page })');
      expect(code).toContain('});');
    });

    it('should generate multiple actions in order', async () => {
      const session = {
        recordedActions: [
          { type: 'navigate', text: 'https://example.com' },
          { type: 'click', selector: '#login' },
          { type: 'type', selector: '#username', text: 'user' },
        ],
      };

      const code = await driver.generatePlaywrightTest(session);

      const gotoPos = code.indexOf('page.goto');
      const clickPos = code.indexOf('page.click');
      const fillPos = code.indexOf('page.fill');

      expect(gotoPos).toBeLessThan(clickPos);
      expect(clickPos).toBeLessThan(fillPos);
    });
  });
});
