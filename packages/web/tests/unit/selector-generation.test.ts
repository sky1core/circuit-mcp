import { describe, it, expect } from 'vitest';
import { WebDriver } from '../../src/web-driver.js';

// Access private methods for testing via any cast
const driver = new WebDriver() as any;

describe('generateSelector edge cases', () => {
  describe('special characters in names', () => {
    it('should escape backslashes in name', () => {
      const node = { role: 'button', name: 'path\\to\\file' };
      const selector = driver.generateSelector(node);

      // Backslashes should be escaped
      expect(selector).toContain('\\\\');
      expect(selector).toBe('button:has-text("path\\\\to\\\\file")');
    });

    it('should escape both backslashes and quotes', () => {
      const node = { role: 'button', name: 'say "hello\\world"' };
      const selector = driver.generateSelector(node);

      // Both should be escaped properly
      expect(selector).toBe('button:has-text("say \\"hello\\\\world\\"")');
    });

    it('should handle newlines in name', () => {
      const node = { role: 'button', name: 'line1\nline2' };
      const selector = driver.generateSelector(node);

      // Should not break selector - newlines in :has-text are fine
      expect(selector).toBeDefined();
      expect(selector).toContain('line1');
    });

    it('should handle empty name', () => {
      const node = { role: 'button', name: '' };
      const selector = driver.generateSelector(node);

      // Empty name should fallback to role selector
      expect(selector).toBe('[role="button"]');
    });

    it('should handle name with only spaces', () => {
      const node = { role: 'button', name: '   ' };
      const selector = driver.generateSelector(node);

      // Should generate selector with spaces
      expect(selector).toBe('button:has-text("   ")');
    });

    it('should handle unicode characters', () => {
      const node = { role: 'button', name: '한글 버튼 🚀' };
      const selector = driver.generateSelector(node);

      expect(selector).toBe('button:has-text("한글 버튼 🚀")');
    });
  });

  describe('heading levels', () => {
    it('should handle heading level 1', () => {
      const node = { role: 'heading', name: 'Title', level: 1 };
      expect(driver.generateSelector(node)).toBe('h1:has-text("Title")');
    });

    it('should handle heading level 6', () => {
      const node = { role: 'heading', name: 'Small', level: 6 };
      expect(driver.generateSelector(node)).toBe('h6:has-text("Small")');
    });

    it('should default to h1 for heading without level', () => {
      const node = { role: 'heading', name: 'Title' };
      expect(driver.generateSelector(node)).toBe('h1:has-text("Title")');
    });

    it('should handle heading level 0 (edge case)', () => {
      const node = { role: 'heading', name: 'Title', level: 0 };
      // 0 is falsy, should default to h1
      expect(driver.generateSelector(node)).toBe('h1:has-text("Title")');
    });
  });

  describe('textbox selectors', () => {
    it('should generate placeholder selector for textbox', () => {
      const node = { role: 'textbox', name: 'Enter email' };
      const selector = driver.generateSelector(node);

      expect(selector).toBe('input[placeholder*="Enter email"]');
    });

    it('should escape special characters in textbox name', () => {
      const node = { role: 'textbox', name: 'Name "required"' };
      const selector = driver.generateSelector(node);

      // Should escape quotes for attribute selector
      expect(selector).toContain('\\"');
    });
  });

  describe('link selectors', () => {
    it('should include href in link selector', () => {
      const node = { role: 'link', name: 'Click here' };
      const selector = driver.generateSelector(node);

      expect(selector).toBe('a[href]:has-text("Click here")');
    });
  });

  describe('fallback selectors', () => {
    it('should fallback to role for unknown roles', () => {
      const node = { role: 'slider', name: 'Volume' };
      const selector = driver.generateSelector(node);

      expect(selector).toBe('[role="slider"]');
    });

    it('should fallback to role when no name provided', () => {
      const node = { role: 'button' };
      const selector = driver.generateSelector(node);

      expect(selector).toBe('[role="button"]');
    });

    it('should handle null name', () => {
      const node = { role: 'button', name: null };
      const selector = driver.generateSelector(node);

      expect(selector).toBe('[role="button"]');
    });

    it('should handle undefined name', () => {
      const node = { role: 'button', name: undefined };
      const selector = driver.generateSelector(node);

      expect(selector).toBe('[role="button"]');
    });
  });
});
