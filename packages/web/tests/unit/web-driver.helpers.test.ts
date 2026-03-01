import { describe, it, expect } from 'vitest';
import { WebDriver, WebSession, PageInfo } from '../../src/web-driver.js';

// Access private methods for testing via any cast
const driver = new WebDriver() as any;

describe('WebDriver Helpers', () => {
  describe('generateSelector', () => {
    it('should generate selector for link with name', () => {
      const node = { role: 'link', name: 'Click here' };
      const selector = driver.generateSelector(node);
      expect(selector).toBe('a[href]:has-text("Click here")');
    });

    it('should generate selector for button with name', () => {
      const node = { role: 'button', name: 'Submit' };
      const selector = driver.generateSelector(node);
      expect(selector).toBe('button:has-text("Submit")');
    });

    it('should generate selector for heading with level', () => {
      const node = { role: 'heading', name: 'Main Title', level: 1 };
      const selector = driver.generateSelector(node);
      expect(selector).toBe('h1:has-text("Main Title")');
    });

    it('should generate selector for heading with level 2', () => {
      const node = { role: 'heading', name: 'Section', level: 2 };
      const selector = driver.generateSelector(node);
      expect(selector).toBe('h2:has-text("Section")');
    });

    it('should generate selector for heading without level (default h1)', () => {
      const node = { role: 'heading', name: 'Title' };
      const selector = driver.generateSelector(node);
      expect(selector).toBe('h1:has-text("Title")');
    });

    it('should generate selector for textbox with name', () => {
      const node = { role: 'textbox', name: 'Email' };
      const selector = driver.generateSelector(node);
      expect(selector).toBe('input[placeholder*="Email"]');
    });

    it('should fallback to role-based selector for unknown roles', () => {
      const node = { role: 'menuitem', name: 'Settings' };
      const selector = driver.generateSelector(node);
      expect(selector).toBe('[role="menuitem"]');
    });

    it('should fallback to role-based selector when no name', () => {
      const node = { role: 'button' };
      const selector = driver.generateSelector(node);
      expect(selector).toBe('[role="button"]');
    });

    it('should escape double quotes in name', () => {
      const node = { role: 'button', name: 'Click "here"' };
      const selector = driver.generateSelector(node);
      // Quotes should be escaped with backslash: \"
      // Result: button:has-text("Click \"here\"")
      expect(selector).toBe('button:has-text("Click \\"here\\"")');
    });

    it('should handle special characters in name', () => {
      const node = { role: 'link', name: "John's link" };
      const selector = driver.generateSelector(node);
      expect(selector).toBeDefined();
    });
  });

  describe('enhanceSnapshotWithRefs', () => {
    it('should return null for null snapshot', () => {
      const pageInfo: Partial<PageInfo> = { elementRefs: new Map() };
      const result = driver.enhanceSnapshotWithRefs(null, pageInfo);
      expect(result).toBeNull();
    });

    it('should add refs to nodes', () => {
      const pageInfo: Partial<PageInfo> = { elementRefs: new Map() };
      const snapshot = {
        role: 'WebArea',
        children: [
          { role: 'button', name: 'Click me' },
          { role: 'link', name: 'Go there' },
        ],
      };

      const result = driver.enhanceSnapshotWithRefs(snapshot, pageInfo);

      expect(result.children[0].ref).toBe('e1');
      expect(result.children[1].ref).toBe('e2');
    });

    it('should not add ref to WebArea role', () => {
      const pageInfo: Partial<PageInfo> = { elementRefs: new Map() };
      const snapshot = { role: 'WebArea', name: 'Document' };

      const result = driver.enhanceSnapshotWithRefs(snapshot, pageInfo);

      expect(result.ref).toBeUndefined();
    });

    it('should store element refs in pageInfo', () => {
      const pageInfo: Partial<PageInfo> = { elementRefs: new Map() };
      const snapshot = {
        role: 'button',
        name: 'Submit',
      };

      driver.enhanceSnapshotWithRefs(snapshot, pageInfo);

      expect(pageInfo.elementRefs!.size).toBe(1);
      const ref = pageInfo.elementRefs!.get('e1');
      expect(ref).toBeDefined();
      expect(ref!.role).toBe('button');
      expect(ref!.name).toBe('Submit');
      expect(ref!.selector).toBe('button:has-text("Submit")');
    });

    it('should process nested children recursively', () => {
      const pageInfo: Partial<PageInfo> = { elementRefs: new Map() };
      const snapshot = {
        role: 'WebArea',
        children: [
          {
            role: 'navigation',
            children: [
              { role: 'link', name: 'Home' },
              { role: 'link', name: 'About' },
            ],
          },
        ],
      };

      const result = driver.enhanceSnapshotWithRefs(snapshot, pageInfo);

      expect(result.children[0].ref).toBe('e1'); // navigation
      expect(result.children[0].children[0].ref).toBe('e2'); // first link
      expect(result.children[0].children[1].ref).toBe('e3'); // second link
    });
  });

  describe('recordAction', () => {
    it('should add action to recordedActions', () => {
      const mockSession = {
        recordedActions: [],
      } as Partial<WebSession>;

      driver.recordAction(mockSession, 'click', '#button');

      expect(mockSession.recordedActions!.length).toBe(1);
      expect(mockSession.recordedActions![0].type).toBe('click');
      expect(mockSession.recordedActions![0].selector).toBe('#button');
    });

    it('should include text when provided', () => {
      const mockSession = {
        recordedActions: [],
      } as Partial<WebSession>;

      driver.recordAction(mockSession, 'type', '#input', 'Hello world');

      expect(mockSession.recordedActions![0].text).toBe('Hello world');
    });

    it('should include timestamp', () => {
      const mockSession = {
        recordedActions: [],
      } as Partial<WebSession>;

      const before = Date.now();
      driver.recordAction(mockSession, 'click', '#button');
      const after = Date.now();

      const timestamp = mockSession.recordedActions![0].timestamp;
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('should limit array size to MAX_RECORDED_ACTIONS (500)', () => {
      const mockSession = {
        recordedActions: [],
      } as Partial<WebSession>;

      // Add 600 actions
      for (let i = 0; i < 600; i++) {
        driver.recordAction(mockSession, 'click', `#button-${i}`);
      }

      expect(mockSession.recordedActions!.length).toBe(500);
      // First 100 should have been removed, so first remaining is #button-100
      expect(mockSession.recordedActions![0].selector).toBe('#button-100');
    });
  });

});
