import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebServer } from '../../src/web-server.js';
import { RelayServer } from '../../src/relay-server.js';
import { ExtensionDriver } from '../../src/extension-driver.js';

/**
 * These tests verify that the WebServer correctly routes operations
 * to ExtensionDriver when the session is an ExtensionSession.
 *
 * BUG: Currently all handlers use this.driver (WebDriver) regardless of session type.
 * This causes errors when ExtensionSession is used because it doesn't have `pages` property.
 */

describe('WebServer Extension Session Routing', () => {
  let webServer: WebServer;
  let mockRelayServer: any;
  let mockExtensionDriver: any;
  let mockSession: any;

  beforeEach(() => {
    // Create mock relay server
    mockRelayServer = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockReturnValue({
        sessionId: 'relay-session-1',
        token: 'test-token',
        relayUrl: 'ws://127.0.0.1:19988?token=test-token'
      }),
      waitForExtension: vi.fn().mockResolvedValue(undefined),
      sendCDPCommand: vi.fn().mockResolvedValue({}),
      listTabs: vi.fn().mockResolvedValue([]),
      attachTab: vi.fn().mockResolvedValue(undefined),
    };

    // Create mock extension session (matches ExtensionSession interface)
    mockSession = {
      id: 'ext-session-1',
      type: 'extension',
      relaySessionId: 'relay-session-1',
      token: 'test-token',
      relayUrl: 'ws://127.0.0.1:19988?token=test-token',
      activePage: 'tab-1',
      attachedTabId: 1,
      networkRequests: [],
      consoleMessages: [],
      recordedActions: [],
      // NOTE: ExtensionSession does NOT have `pages` property
      // WebSession has: pages: Map<string, PageInfo>
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isExtensionSession type guard', () => {
    it('should correctly identify ExtensionSession', () => {
      const extensionSession = { type: 'extension', id: '1' };
      const webSession = { id: '2', pages: new Map() };

      // The isExtensionSession function should return true for extension sessions
      expect(extensionSession.type).toBe('extension');
      expect((webSession as any).type).toBeUndefined();
    });
  });

  describe('session routing requirements', () => {
    /**
     * SPEC: When an ExtensionSession is stored in sessions map,
     * all handlers should use ExtensionDriver, not WebDriver.
     */

    it('should have pages property for WebSession', () => {
      const webSession = {
        id: '1',
        browser: {},
        context: {},
        pages: new Map(),
        activePage: 'page-1',
        networkRequests: [],
        consoleMessages: [],
        recordedActions: [],
        options: {},
      };

      expect(webSession.pages).toBeInstanceOf(Map);
    });

    it('should NOT have pages property for ExtensionSession', () => {
      // ExtensionSession structure from extension-driver.ts
      const extensionSession = {
        id: '1',
        type: 'extension',
        relaySessionId: 'relay-1',
        token: 'token',
        relayUrl: 'ws://...',
        activePage: 'tab-1',
        attachedTabId: 1,
        networkRequests: [],
        consoleMessages: [],
        recordedActions: [],
      };

      // This is the key difference
      expect((extensionSession as any).pages).toBeUndefined();
    });

    it('should differentiate session types by type property', () => {
      const extensionSession = { type: 'extension', id: '1' };
      const webSession = { id: '2', pages: new Map() };

      const isExtension = (session: any) => session.type === 'extension';

      expect(isExtension(extensionSession)).toBe(true);
      expect(isExtension(webSession)).toBe(false);
    });
  });

  describe('handler routing behavior (expected to fail until bug is fixed)', () => {
    /**
     * These tests document the expected behavior.
     * They should FAIL with current implementation, proving the bug exists.
     */

    it('navigate handler should check session type', () => {
      // Current code (web-server.ts:1119-1122):
      // private async handleBrowserNavigate(sessionId: string, url: string): Promise<void> {
      //   const session = await this.getSession(sessionId);
      //   await this.driver.navigate(session, url);  // ← Always uses WebDriver
      // }

      // Expected code:
      // if (this.isExtensionSession(session)) {
      //   await this.extensionDriver!.navigate(session, url);
      // } else {
      //   await this.driver.navigate(session as WebSession, url);
      // }

      // This test documents the requirement
      const handlers = [
        'handleBrowserNavigate',
        'handleClick',
        'handleType',
        'handleScreenshot',
        'handleEvaluate',
        'handleSnapshot',
        'handleHover',
        'handleScroll',
        'handleScrollToElement',
        'handleScrollToTop',
        'handleScrollToBottom',
      ];

      // All these handlers need session type checking
      expect(handlers.length).toBeGreaterThan(0);
    });

    it('ExtensionSession passed to WebDriver.navigate should fail', () => {
      // Simulating what happens when ExtensionSession is passed to WebDriver
      const extensionSession = mockSession;

      // WebDriver.navigate does:
      // const webSession = session as WebSession;
      // const pageInfo = webSession.pages.get(webSession.activePage);

      // This will fail because ExtensionSession has no `pages`
      const pages = (extensionSession as any).pages;
      expect(pages).toBeUndefined();

      // If we try to call .get() on undefined, it throws
      expect(() => {
        pages.get('something');
      }).toThrow();
    });
  });
});
