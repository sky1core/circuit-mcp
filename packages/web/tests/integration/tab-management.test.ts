import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { WebDriver, WebSession } from '../../src/web-driver.js';

describe('WebDriver Tab Management', () => {
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
  });

  afterEach(async () => {
    if (session) {
      await driver.close(session);
    }
  });

  describe('closeTab', () => {
    it('should close a tab and switch to another', async () => {
      const tab1 = session.activePage;
      const tab2 = await driver.newTab(session);

      await driver.selectTab(session, tab2);
      expect(session.activePage).toBe(tab2);

      await driver.closeTab(session, tab2);

      // Should have switched to remaining tab
      expect(session.activePage).toBe(tab1);
      expect(session.pages.size).toBe(1);
    });

    it('should prevent closing the last tab', async () => {
      const onlyTab = session.activePage;

      await expect(driver.closeTab(session, onlyTab))
        .rejects.toThrow('Cannot close the last tab');

      // Tab should still exist (not closed)
      expect(session.pages.has(onlyTab)).toBe(true);
      expect(session.pages.size).toBe(1);
    });

    it('should allow closing non-active tab', async () => {
      const tab1 = session.activePage;
      const tab2 = await driver.newTab(session);

      // Stay on tab1, close tab2
      await driver.closeTab(session, tab2);

      expect(session.activePage).toBe(tab1);
      expect(session.pages.has(tab2)).toBe(false);
    });

    it('should throw error for non-existent tab', async () => {
      await expect(driver.closeTab(session, 'non-existent-tab-id'))
        .rejects.toThrow('Tab not found');
    });
  });

  describe('newTab', () => {
    it('should create a new tab with unique ID', async () => {
      const tab1 = session.activePage;
      const tab2 = await driver.newTab(session);

      expect(tab2).toBeDefined();
      expect(tab2).not.toBe(tab1);
      expect(session.pages.size).toBe(2);
    });

    it('should not change active tab when creating new tab', async () => {
      const tab1 = session.activePage;
      await driver.newTab(session);

      // Active tab should still be the original
      expect(session.activePage).toBe(tab1);
    });
  });

  describe('selectTab', () => {
    it('should switch active tab', async () => {
      const tab1 = session.activePage;
      const tab2 = await driver.newTab(session);

      await driver.selectTab(session, tab2);
      expect(session.activePage).toBe(tab2);

      await driver.selectTab(session, tab1);
      expect(session.activePage).toBe(tab1);
    });

    it('should throw error for non-existent tab', async () => {
      await expect(driver.selectTab(session, 'non-existent-tab-id'))
        .rejects.toThrow('Tab not found');
    });
  });

  describe('listTabs', () => {
    it('should list all tabs with correct info', async () => {
      const tab2 = await driver.newTab(session);
      const tab3 = await driver.newTab(session);

      const tabs = await driver.listTabs(session);

      expect(tabs.length).toBe(3);
      expect(tabs.every(t => t.id && t.title && 'url' in t && 'active' in t)).toBe(true);
    });

    it('should mark exactly one tab as active', async () => {
      await driver.newTab(session);
      await driver.newTab(session);

      const tabs = await driver.listTabs(session);
      const activeTabs = tabs.filter(t => t.active);

      expect(activeTabs.length).toBe(1);
    });
  });
});
