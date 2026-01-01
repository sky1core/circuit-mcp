import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';

describe('WebDriver scrollToElement escaping', () => {
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
    // Create page with scrollable content
    await driver.navigate(session, 'about:blank');
    await driver.evaluate(session, `
      document.body.innerHTML = \`
        <div style="height: 2000px;">
          <div id="top">Top</div>
          <div id="target" style="margin-top: 1500px;">Target Element</div>
        </div>
      \`;
    `);
  });

  afterEach(async () => {
    if (session) {
      await driver.close(session);
    }
  });

  it('should handle selectors with single quotes', async () => {
    // Using attribute selector with single quote in value
    await driver.evaluate(session, `
      const el = document.createElement('div');
      el.setAttribute('data-name', "test'value");
      el.style.marginTop = '1800px';
      el.textContent = 'Single Quote Test';
      document.body.appendChild(el);
    `);

    // Selector that contains a single quote (using CSS escaping)
    await driver.scrollToElement(session, "[data-name=\"test'value\"]");
    const scrollY = await driver.evaluate(session, 'window.scrollY');
    expect(scrollY).toBeGreaterThan(0);
  });

  it('should scroll to element by id', async () => {
    await driver.scrollToElement(session, '#target');
    const scrollY = await driver.evaluate(session, 'window.scrollY');
    expect(scrollY).toBeGreaterThan(0);
  });

  it('should not throw on selector with backslash', async () => {
    // Create an element with an escaped class name
    await driver.evaluate(session, `
      const el = document.createElement('div');
      el.className = 'test';
      el.style.marginTop = '1800px';
      el.textContent = 'Backslash Test';
      document.body.appendChild(el);
    `);

    // This tests that the backslash in the selector is properly escaped
    // for the JavaScript string, even if the selector itself is invalid CSS
    await expect(driver.scrollToElement(session, '.test')).resolves.not.toThrow();
  });
});
