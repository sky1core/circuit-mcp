import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';

describe('Element Query Tools', () => {
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
    // Set up test page with various elements
    await driver.navigate(session, 'about:blank');
    await driver.evaluate(session, `
      document.body.innerHTML = \`
        <div id="container">
          <h1 class="title">Test Page</h1>
          <p id="description">This is a test paragraph.</p>
          <a id="link" href="https://example.com" data-testid="main-link">Click me</a>
          <input id="username" type="text" value="john_doe" />
          <button id="submit" disabled>Submit</button>
          <ul id="list">
            <li class="item">Item 1</li>
            <li class="item">Item 2</li>
            <li class="item">Item 3</li>
          </ul>
          <div id="hidden" style="display: none;">Hidden content</div>
        </div>
      \`;
    `);
  });

  afterEach(async () => {
    if (session) {
      await driver.close(session);
    }
  });

  describe('exists', () => {
    it('should return true for existing element', async () => {
      const result = await driver.exists(session, '#container');
      expect(result).toBe(true);
    });

    it('should return false for non-existing element', async () => {
      const result = await driver.exists(session, '#non-existent');
      expect(result).toBe(false);
    });

    it('should work with class selectors', async () => {
      const result = await driver.exists(session, '.title');
      expect(result).toBe(true);
    });

    it('should work with complex selectors', async () => {
      const result = await driver.exists(session, '#list .item');
      expect(result).toBe(true);
    });

    it('should return true for hidden elements', async () => {
      const result = await driver.exists(session, '#hidden');
      expect(result).toBe(true);
    });
  });

  describe('getText', () => {
    it('should return text content of element', async () => {
      const result = await driver.getText(session, '#description');
      expect(result).toBe('This is a test paragraph.');
    });

    it('should return null for non-existing element', async () => {
      const result = await driver.getText(session, '#non-existent');
      expect(result).toBeNull();
    });

    it('should return text of first matching element', async () => {
      const result = await driver.getText(session, '.item');
      expect(result).toBe('Item 1');
    });

    it('should return link text', async () => {
      const result = await driver.getText(session, '#link');
      expect(result).toBe('Click me');
    });

    it('should return heading text', async () => {
      const result = await driver.getText(session, 'h1');
      expect(result).toBe('Test Page');
    });
  });

  describe('getAttribute', () => {
    it('should return href attribute', async () => {
      const result = await driver.getAttribute(session, '#link', 'href');
      expect(result).toBe('https://example.com');
    });

    it('should return data attribute', async () => {
      const result = await driver.getAttribute(session, '#link', 'data-testid');
      expect(result).toBe('main-link');
    });

    it('should return input value', async () => {
      const result = await driver.getAttribute(session, '#username', 'value');
      expect(result).toBe('john_doe');
    });

    it('should return disabled attribute', async () => {
      const result = await driver.getAttribute(session, '#submit', 'disabled');
      expect(result).toBe('');
    });

    it('should return null for non-existing attribute', async () => {
      const result = await driver.getAttribute(session, '#link', 'non-existent');
      expect(result).toBeNull();
    });

    it('should return null for non-existing element', async () => {
      const result = await driver.getAttribute(session, '#non-existent', 'href');
      expect(result).toBeNull();
    });

    it('should return type attribute', async () => {
      const result = await driver.getAttribute(session, '#username', 'type');
      expect(result).toBe('text');
    });
  });
});
