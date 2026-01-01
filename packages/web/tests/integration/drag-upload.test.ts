import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('WebDriver Drag and Upload', () => {
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

  describe('drag', () => {
    it('should drag element to target', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = \`
          <div id="source" draggable="true" style="width: 50px; height: 50px; background: blue;"></div>
          <div id="target" style="width: 100px; height: 100px; background: green; margin-top: 20px;"></div>
        \`;
        window.dropped = false;
        document.getElementById('target').ondrop = (e) => {
          e.preventDefault();
          window.dropped = true;
        };
        document.getElementById('target').ondragover = (e) => e.preventDefault();
      `);

      await driver.drag(session, '#source', '#target');

      // Record action should be tracked
      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('drag');
      expect(lastAction.selector).toContain('#source');
      expect(lastAction.selector).toContain('#target');
    });

    it('should record drag action with both selectors', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = \`
          <div id="draggable" draggable="true">Drag me</div>
          <div id="dropzone">Drop here</div>
        \`;
      `);

      await driver.drag(session, '#draggable', '#dropzone');

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('drag');
      expect(lastAction.selector).toBe('#draggable to #dropzone');
    });
  });

  describe('upload', () => {
    let tempFile: string;

    beforeEach(async () => {
      // Create a temporary file for upload testing
      tempFile = path.join(os.tmpdir(), 'test-upload.txt');
      fs.writeFileSync(tempFile, 'test content');
    });

    afterEach(() => {
      // Cleanup temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });

    it('should upload file to input element', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<input type="file" id="fileInput">';
      `);

      await driver.upload(session, '#fileInput', tempFile);

      const fileName = await driver.evaluate(session, `
        document.getElementById('fileInput').files[0]?.name
      `);
      expect(fileName).toBe('test-upload.txt');
    });

    it('should record upload action', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<input type="file" id="fileInput">';
      `);

      await driver.upload(session, '#fileInput', tempFile);

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('upload');
      expect(lastAction.selector).toBe('#fileInput');
      expect(lastAction.text).toBe(tempFile);
    });
  });

  describe('waitForSelector', () => {
    it('should wait for element to appear', async () => {
      // Set up a delayed element
      driver.evaluate(session, `
        setTimeout(() => {
          document.body.innerHTML = '<div id="delayed">Appeared!</div>';
        }, 100);
      `);

      // This should wait and succeed
      await driver.waitForSelector(session, '#delayed', 5000);

      const text = await driver.evaluate(session, 'document.getElementById("delayed")?.textContent');
      expect(text).toBe('Appeared!');
    });

    it('should timeout if element never appears', async () => {
      await expect(driver.waitForSelector(session, '#nonexistent', 500))
        .rejects.toThrow();
    });

    it('should succeed immediately if element exists', async () => {
      await driver.evaluate(session, `
        document.body.innerHTML = '<div id="existing">Already here</div>';
      `);

      const start = Date.now();
      await driver.waitForSelector(session, '#existing', 5000);
      const duration = Date.now() - start;

      // Should complete quickly, not wait the full timeout
      expect(duration).toBeLessThan(1000);
    });
  });
});
