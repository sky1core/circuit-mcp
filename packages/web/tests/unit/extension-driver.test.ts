import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExtensionDriver, ExtensionSession } from '../../src/extension-driver.js';
import { RelayServer } from '../../src/relay-server.js';
import * as fs from 'fs/promises';

// Mock the RelayServer
const mockRelay = {
  createSession: vi.fn(),
  waitForExtension: vi.fn(),
  listTabs: vi.fn(),
  attachTab: vi.fn(),
  detachTab: vi.fn(),
  destroySession: vi.fn(),
  sendCDPCommand: vi.fn(),
  closeTab: vi.fn(),
  on: vi.fn(),
  port: 19988,
} as unknown as RelayServer;

describe('ExtensionDriver', () => {
  let driver: ExtensionDriver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new ExtensionDriver(mockRelay);
  });

  describe('connect', () => {
    it('should create a session and return immediately', async () => {
      mockRelay.createSession = vi.fn().mockReturnValue('test-session-id');

      const session = await driver.connect();

      expect(mockRelay.createSession).toHaveBeenCalled();
      // connect() no longer waits for extension - it returns immediately
      expect(mockRelay.waitForExtension).not.toHaveBeenCalled();
      expect(session.type).toBe('extension');
      expect(session.relaySessionId).toBe('test-session-id');
    });
  });

  describe('waitForConnection', () => {
    it('should wait for extension with specified timeout', async () => {
      mockRelay.waitForExtension = vi.fn().mockResolvedValue(undefined);

      const session = createMockSession();
      await driver.waitForConnection(session, 5000);

      expect(mockRelay.waitForExtension).toHaveBeenCalledWith(5000);
    });

    it('should use default timeout when not specified', async () => {
      mockRelay.waitForExtension = vi.fn().mockResolvedValue(undefined);

      const session = createMockSession();
      await driver.waitForConnection(session);

      expect(mockRelay.waitForExtension).toHaveBeenCalledWith(60000);
    });
  });

  describe('listTabs', () => {
    it('should return tabs from relay', async () => {
      const mockTabs = [
        { id: 1, title: 'Tab 1', url: 'https://example.com/1' },
        { id: 2, title: 'Tab 2', url: 'https://example.com/2' },
      ];
      mockRelay.listTabs = vi.fn().mockResolvedValue(mockTabs);

      const session = createMockSession();
      const tabs = await driver.listTabs(session);

      expect(mockRelay.listTabs).toHaveBeenCalledWith('test-relay-session');
      expect(tabs).toEqual(mockTabs);
    });
  });

  describe('attachTab', () => {
    it('should attach to a tab and update session', async () => {
      mockRelay.attachTab = vi.fn().mockResolvedValue(undefined);

      const session = createMockSession();
      await driver.attachTab(session, 123);

      expect(mockRelay.attachTab).toHaveBeenCalledWith('test-relay-session', 123);
      expect(session.attachedTabId).toBe(123);
      expect(session.activePage).toBe('tab-123');
    });
  });

  describe('navigate', () => {
    it('should send Page.navigate CDP command', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({});

      const session = createMockSession();
      await driver.navigate(session, 'https://example.com');

      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Page.navigate',
        { url: 'https://example.com' }
      );
    });

    it('should record navigate action', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({});

      const session = createMockSession();
      await driver.navigate(session, 'https://example.com');

      const lastAction = session.recordedActions[session.recordedActions.length - 1];
      expect(lastAction.type).toBe('navigate');
      expect(lastAction.text).toBe('https://example.com');
    });
  });

  describe('click', () => {
    it('should send mouse events via CDP', async () => {
      mockRelay.sendCDPCommand = vi.fn()
        .mockResolvedValueOnce({ root: { nodeId: 1 } }) // DOM.getDocument
        .mockResolvedValueOnce({ nodeId: 2 }) // DOM.querySelector
        .mockResolvedValueOnce({ model: { content: [100, 100, 200, 100, 200, 200, 100, 200] } }) // DOM.getBoxModel
        .mockResolvedValueOnce({}) // mousePressed
        .mockResolvedValueOnce({}); // mouseReleased

      const session = createMockSession();
      await driver.click(session, '#button');

      // Should have called mousePressed and mouseReleased
      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Input.dispatchMouseEvent',
        expect.objectContaining({ type: 'mousePressed' })
      );
      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Input.dispatchMouseEvent',
        expect.objectContaining({ type: 'mouseReleased' })
      );
    });

    it('should throw error when element not found', async () => {
      mockRelay.sendCDPCommand = vi.fn()
        .mockResolvedValueOnce({ root: { nodeId: 1 } }) // DOM.getDocument
        .mockResolvedValueOnce({ nodeId: 0 }); // DOM.querySelector returns 0 for not found

      const session = createMockSession();
      await expect(driver.click(session, '#non-existent')).rejects.toThrow('Element not found');
    });
  });

  describe('scroll', () => {
    it('should send mouseWheel event for scroll down', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({});

      const session = createMockSession();
      await driver.scroll(session, 'down', 500);

      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mouseWheel',
          deltaY: 500,
          deltaX: 0,
        })
      );
    });

    it('should send mouseWheel event for scroll up', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({});

      const session = createMockSession();
      await driver.scroll(session, 'up', 300);

      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mouseWheel',
          deltaY: -300,
          deltaX: 0,
        })
      );
    });

    it('should use default scroll amount', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({});

      const session = createMockSession();
      await driver.scroll(session, 'down');

      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          deltaY: 500, // default amount
        })
      );
    });

    it('should handle horizontal scroll', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({});

      const session = createMockSession();
      await driver.scroll(session, 'right', 200);

      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          deltaX: 200,
          deltaY: 0,
        })
      );
    });
  });

  describe('screenshot', () => {
    it('should capture screenshot via CDP and save to file', async () => {
      // Use valid base64 data
      const validBase64 = Buffer.from('fake-image-data').toString('base64');
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({
        data: validBase64,
      });

      const session = createMockSession();
      const result = await driver.screenshot(session);

      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Page.captureScreenshot',
        { format: 'jpeg', quality: 50 }
      );
      // Should return a path, not base64 data
      expect(result).toMatch(/^screenshot-\d+\.jpeg$/);

      // Verify file was created and clean up
      const fileContent = await fs.readFile(result);
      expect(fileContent.toString()).toBe('fake-image-data');
      await fs.unlink(result);
    });

    it('should save to custom path when provided', async () => {
      const validBase64 = Buffer.from('custom-image-data').toString('base64');
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({
        data: validBase64,
      });

      const session = createMockSession();
      const customPath = `test-screenshot-${Date.now()}.jpeg`;
      const result = await driver.screenshot(session, customPath);

      expect(result).toBe(customPath);

      // Verify file was created and clean up
      const fileContent = await fs.readFile(result);
      expect(fileContent.toString()).toBe('custom-image-data');
      await fs.unlink(result);
    });
  });

  describe('evaluate', () => {
    it('should execute script via CDP', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({
        result: { value: 42 },
      });

      const session = createMockSession();
      const result = await driver.evaluate(session, '21 * 2');

      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Runtime.evaluate',
        {
          expression: '21 * 2',
          returnByValue: true,
          awaitPromise: true,
        }
      );
      expect(result).toBe(42);
    });
  });

  describe('refresh', () => {
    it('should send Page.reload CDP command', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({});

      const session = createMockSession();
      await driver.refresh(session);

      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Page.reload',
        {}
      );
    });
  });

  describe('close', () => {
    it('should destroy session when no tab attached', async () => {
      mockRelay.destroySession = vi.fn();

      const session = createMockSession();
      await driver.close(session);

      expect(mockRelay.closeTab).not.toHaveBeenCalled();
      expect(mockRelay.destroySession).toHaveBeenCalledWith('test-relay-session');
    });

    it('should close attached tab via closeTab then destroy session', async () => {
      mockRelay.detachTab = vi.fn().mockResolvedValue(undefined);
      mockRelay.closeTab = vi.fn().mockResolvedValue(undefined);
      mockRelay.destroySession = vi.fn();

      const session = createMockSession();
      session.attachedTabId = 42;

      await driver.close(session);

      // closeTab internally calls detachTab + relay.closeTab
      expect(mockRelay.detachTab).toHaveBeenCalledWith('test-relay-session');
      expect(mockRelay.closeTab).toHaveBeenCalledWith('test-relay-session', 42);
      expect(mockRelay.destroySession).toHaveBeenCalledWith('test-relay-session');
    });
  });

  describe('exists', () => {
    it('should return true when element exists', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({
        result: { value: true },
      });

      const session = createMockSession();
      const result = await driver.exists(session, '#existing-element');

      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Runtime.evaluate',
        expect.objectContaining({
          expression: expect.stringContaining('querySelector'),
        })
      );
      expect(result).toBe(true);
    });

    it('should return false when element does not exist', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({
        result: { value: false },
      });

      const session = createMockSession();
      const result = await driver.exists(session, '#non-existent');

      expect(result).toBe(false);
    });

    it('should properly escape selector with special characters', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({
        result: { value: true },
      });

      const session = createMockSession();
      await driver.exists(session, "input[data-test='value']");

      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Runtime.evaluate',
        expect.objectContaining({
          expression: expect.stringContaining("\\'value\\'"),
        })
      );
    });
  });

  describe('getText', () => {
    it('should return text content of element', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({
        result: { value: 'Hello World' },
      });

      const session = createMockSession();
      const result = await driver.getText(session, '#text-element');

      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Runtime.evaluate',
        expect.objectContaining({
          expression: expect.stringContaining('textContent'),
        })
      );
      expect(result).toBe('Hello World');
    });

    it('should return null when element not found', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({
        result: { value: null },
      });

      const session = createMockSession();
      const result = await driver.getText(session, '#non-existent');

      expect(result).toBeNull();
    });

    it('should return empty string for element with no text', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({
        result: { value: '' },
      });

      const session = createMockSession();
      const result = await driver.getText(session, '#empty-element');

      expect(result).toBe('');
    });
  });

  describe('getAttribute', () => {
    it('should return attribute value', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({
        result: { value: 'https://example.com' },
      });

      const session = createMockSession();
      const result = await driver.getAttribute(session, 'a#link', 'href');

      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Runtime.evaluate',
        expect.objectContaining({
          expression: expect.stringContaining("getAttribute('href')"),
        })
      );
      expect(result).toBe('https://example.com');
    });

    it('should return null for non-existent element', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({
        result: { value: null },
      });

      const session = createMockSession();
      const result = await driver.getAttribute(session, '#non-existent', 'class');

      expect(result).toBeNull();
    });

    it('should return null for non-existent attribute', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({
        result: { value: null },
      });

      const session = createMockSession();
      const result = await driver.getAttribute(session, '#element', 'non-existent-attr');

      expect(result).toBeNull();
    });

    it('should properly escape attribute name with special characters', async () => {
      mockRelay.sendCDPCommand = vi.fn().mockResolvedValue({
        result: { value: 'value' },
      });

      const session = createMockSession();
      await driver.getAttribute(session, '#element', "data-test's");

      expect(mockRelay.sendCDPCommand).toHaveBeenCalledWith(
        'test-relay-session',
        'Runtime.evaluate',
        expect.objectContaining({
          expression: expect.stringContaining("data-test\\'s"),
        })
      );
    });

    it('should get common attributes like src and data-*', async () => {
      mockRelay.sendCDPCommand = vi.fn()
        .mockResolvedValueOnce({ result: { value: '/image.png' } })
        .mockResolvedValueOnce({ result: { value: '123' } });

      const session = createMockSession();

      const src = await driver.getAttribute(session, 'img', 'src');
      expect(src).toBe('/image.png');

      const dataId = await driver.getAttribute(session, 'div', 'data-id');
      expect(dataId).toBe('123');
    });
  });

});

// Helper function to create a mock session
function createMockSession(): ExtensionSession {
  return {
    id: 'test-session',
    type: 'extension',
    relaySessionId: 'test-relay-session',
    relayPort: 19988,
    activePage: '',
    attachedTabId: null,
    networkRequests: [],
    consoleMessages: [],
    recordedActions: [],
  };
}
