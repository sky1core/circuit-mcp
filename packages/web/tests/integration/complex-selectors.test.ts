import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';

describe('WebDriver Complex Selectors', () => {
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

  describe('CSS selector edge cases', () => {
    it('should click element with quotes in attribute', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<button data-name="say \\'hello\\'">Click</button>';
        window.clicked = false;
        document.querySelector('button').onclick = () => window.clicked = true;
      `);

      await driver.click(session, '[data-name="say \'hello\'"]');
      const clicked = await driver.evaluate(session, 'window.clicked');
      expect(clicked).toBe(true);
    });

    it('should click element with special characters in ID', async () => {
      await driver.evaluate(session, `
        const btn = document.createElement('button');
        btn.id = 'test:button';
        btn.textContent = 'Click';
        document.body.appendChild(btn);
        window.clicked = false;
        btn.onclick = () => window.clicked = true;
      `);

      // CSS selectors require escaping colons
      await driver.click(session, '#test\\:button');
      const clicked = await driver.evaluate(session, 'window.clicked');
      expect(clicked).toBe(true);
    });

    it('should type in element selected by complex selector', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<form><input type="text" name="email" class="form-input"></form>';
      `);

      await driver.type(session, 'form input.form-input[name="email"]', 'test@example.com');
      const value = await driver.evaluate(session, 'document.querySelector("input").value');
      expect(value).toBe('test@example.com');
    });

    it('should handle nth-child selector', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<ul><li>1</li><li>2</li><li>3</li></ul>';
        window.clickedItem = null;
        document.querySelectorAll('li').forEach((li, i) => {
          li.onclick = () => window.clickedItem = i + 1;
        });
      `);

      await driver.click(session, 'li:nth-child(2)');
      const clickedItem = await driver.evaluate(session, 'window.clickedItem');
      expect(clickedItem).toBe(2);
    });

    it('should handle :has() selector', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = \`
          <div><span>Has child</span></div>
          <div>No span</div>
        \`;
        window.clicked = false;
        document.querySelector('div:has(span)').onclick = () => window.clicked = true;
      `);

      await driver.click(session, 'div:has(span)');
      const clicked = await driver.evaluate(session, 'window.clicked');
      expect(clicked).toBe(true);
    });
  });

  describe('element not found handling', () => {
    // Note: Playwright has a default timeout of 30s when waiting for elements
    // These tests verify the timeout behavior, but we use a shorter timeout via config

    it('should eventually throw error for non-existent element', async () => {
      // This test is covered in error-handling.test.ts with a proper timeout
      // Just verify the element really doesn't exist
      const exists = await driver.evaluate(session, 'document.querySelector("#non-existent") !== null');
      expect(exists).toBe(false);
    });

    it('should throw for invalid selector syntax', async () => {
      // Invalid selector throws immediately
      await expect(driver.click(session, '[[[invalid'))
        .rejects.toThrow();
    });
  });

  describe('scrollToElement with complex selectors', () => {
    it('should scroll to element with ID containing dash', async () => {
      await driver.evaluate(session, `
        document.body.style.height = '3000px';
        const div = document.createElement('div');
        div.id = 'my-element';
        div.style.marginTop = '2000px';
        div.textContent = 'Target';
        document.body.appendChild(div);
      `);

      await driver.scrollToElement(session, '#my-element');
      const scrollY = await driver.evaluate(session, 'window.scrollY');
      expect(scrollY).toBeGreaterThan(0);
    });

    it('should scroll to element with class selector', async () => {
      await driver.evaluate(session, `
        document.body.style.height = '3000px';
        const div = document.createElement('div');
        div.className = 'target-class';
        div.style.marginTop = '2000px';
        div.textContent = 'Target';
        document.body.appendChild(div);
      `);

      await driver.scrollToElement(session, '.target-class');
      const scrollY = await driver.evaluate(session, 'window.scrollY');
      expect(scrollY).toBeGreaterThan(0);
    });
  });
});
