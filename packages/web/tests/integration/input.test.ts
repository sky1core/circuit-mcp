import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';

describe('WebDriver Input Interactions', () => {
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

  describe('click', () => {
    it('should click a button', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<button id="btn">Click me</button>';
        window.clicked = false;
        document.getElementById('btn').onclick = () => { window.clicked = true; };
      `);

      await driver.click(session, '#btn');

      const clicked = await driver.evaluate(session, 'window.clicked');
      expect(clicked).toBe(true);
    });

    it('should record click action', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<button id="btn">Click</button>';
      `);

      await driver.click(session, '#btn');

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('click');
      expect(lastAction.selector).toBe('#btn');
    });

    it('should throw error for non-existent element', async () => {
      // Playwright waits for elements by default, so this will timeout
      // We're just verifying it eventually throws
      await expect(
        (async () => {
          const pageInfo = session.pages.get(session.activePage);
          if (!pageInfo) throw new Error('No active page');
          await pageInfo.page.click('#nonexistent', { timeout: 1000 });
        })()
      ).rejects.toThrow();
    }, 5000);
  });

  describe('type', () => {
    it('should type text into input', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<input id="input" type="text">';
      `);

      await driver.type(session, '#input', 'Hello World');

      const value = await driver.evaluate(session, 'document.getElementById("input").value');
      expect(value).toBe('Hello World');
    });

    it('should replace existing text', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<input id="input" type="text" value="old">';
      `);

      await driver.type(session, '#input', 'new');

      const value = await driver.evaluate(session, 'document.getElementById("input").value');
      expect(value).toBe('new');
    });

    it('should record type action', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<input id="input">';
      `);

      await driver.type(session, '#input', 'test');

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('type');
      expect(lastAction.selector).toBe('#input');
      expect(lastAction.text).toBe('test');
    });

    it('should handle special characters', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<input id="input">';
      `);

      await driver.type(session, '#input', 'Test "quotes" and \'apostrophes\'');

      const value = await driver.evaluate(session, 'document.getElementById("input").value');
      expect(value).toBe('Test "quotes" and \'apostrophes\'');
    });
  });

  describe('key', () => {
    it('should press Enter key', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<input id="input">';
        window.enterPressed = false;
        document.getElementById('input').onkeydown = (e) => {
          if (e.key === 'Enter') window.enterPressed = true;
        };
        document.getElementById('input').focus();
      `);

      await driver.key(session, 'Enter');

      const pressed = await driver.evaluate(session, 'window.enterPressed');
      expect(pressed).toBe(true);
    });

    it('should record key action', async () => {
      await driver.key(session, 'Escape');

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('key');
      expect(lastAction.text).toBe('Escape');
    });
  });

  describe('hover', () => {
    it('should trigger hover effect', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<div id="target">Hover me</div>';
        window.hovered = false;
        document.getElementById('target').onmouseenter = () => { window.hovered = true; };
      `);

      await driver.hover(session, '#target');

      const hovered = await driver.evaluate(session, 'window.hovered');
      expect(hovered).toBe(true);
    });

    it('should record hover action', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<div id="target">Hover</div>';
      `);

      await driver.hover(session, '#target');

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('hover');
      expect(lastAction.selector).toBe('#target');
    });
  });

  describe('select', () => {
    it('should select option by value', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = \`
          <select id="dropdown">
            <option value="a">Option A</option>
            <option value="b">Option B</option>
            <option value="c">Option C</option>
          </select>
        \`;
      `);

      await driver.select(session, '#dropdown', 'b');

      const value = await driver.evaluate(session, 'document.getElementById("dropdown").value');
      expect(value).toBe('b');
    });

    it('should record select action', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<select id="dropdown"><option value="x">X</option></select>';
      `);

      await driver.select(session, '#dropdown', 'x');

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('select');
      expect(lastAction.selector).toBe('#dropdown');
      expect(lastAction.text).toBe('x');
    });
  });
});
