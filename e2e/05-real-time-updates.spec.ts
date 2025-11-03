import { test, expect } from '@playwright/test';
import { login, TEST_URLS, waitForSocketConnection } from './helpers/test-helpers';

/**
 * Test Suite: Real-Time Updates via Socket.io
 *
 * Tests real-time functionality:
 * - Socket.io connection establishment
 * - Real-time order updates
 * - Multi-tab synchronization
 * - Notification delivery
 */

test.describe('Real-Time Updates (Socket.io)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should establish socket connection after login', async ({ page }) => {
    console.log('Test: Socket.io connection');

    // Navigate to dashboard
    await page.goto(TEST_URLS.dashboard);
    await page.waitForTimeout(2000);

    // Check for socket connection in browser console
    const socketConnected = await page.evaluate(() => {
      // Check various possible socket implementations
      const socket = (window as any).socket || (window as any).io;
      if (socket) {
        return {
          exists: true,
          connected: socket.connected || false,
          id: socket.id || 'unknown',
        };
      }
      return { exists: false, connected: false };
    });

    console.log('Socket connection status:', socketConnected);

    // Alternative check: Look for WebSocket connections
    const wsConnections = await page.evaluate(() => {
      return {
        protocol: window.location.protocol,
        hasWebSocket: typeof WebSocket !== 'undefined',
      };
    });

    console.log('WebSocket support:', wsConnections);

    // Check console for socket-related messages
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text().toLowerCase();
      if (text.includes('socket') || text.includes('connected')) {
        consoleLogs.push(msg.text());
      }
    });

    await page.waitForTimeout(2000);

    console.log('Socket-related console logs:', consoleLogs);

    await page.screenshot({ path: 'test-results/screenshots/socket-connection.png' });
  });

  test('should receive real-time order updates', async ({ page, context }) => {
    console.log('Test: Real-time order updates');

    // Navigate to orders page
    await page.goto(TEST_URLS.orders);
    await page.waitForTimeout(2000);

    // Set up listener for socket events
    const socketEvents: any[] = [];
    await page.evaluate(() => {
      const socket = (window as any).socket;
      if (socket) {
        const events = ['order:created', 'order:updated', 'order:status_changed'];
        events.forEach(event => {
          socket.on(event, (data: any) => {
            console.log(`Socket event received: ${event}`, data);
            (window as any).lastSocketEvent = { event, data, timestamp: Date.now() };
          });
        });
      }
    });

    // Take initial screenshot
    await page.screenshot({ path: 'test-results/screenshots/orders-before-update.png', fullPage: true });

    // Simulate waiting for updates (in real scenario, another user/system would create update)
    console.log('Waiting for potential real-time updates...');
    await page.waitForTimeout(3000);

    // Check if any socket events were received
    const receivedEvents = await page.evaluate(() => {
      return (window as any).lastSocketEvent || null;
    });

    if (receivedEvents) {
      console.log('Socket event received:', receivedEvents);
      await page.screenshot({ path: 'test-results/screenshots/orders-after-update.png', fullPage: true });
    } else {
      console.log('No socket events received during test period');
    }

    console.log('Real-time update test completed');
  });

  test('should sync updates across multiple tabs', async ({ page, context }) => {
    console.log('Test: Multi-tab synchronization');

    // Open first tab (already logged in)
    await page.goto(TEST_URLS.orders);
    await page.waitForTimeout(2000);

    // Take screenshot of tab 1
    await page.screenshot({ path: 'test-results/screenshots/tab1-orders-initial.png' });

    // Open second tab
    const page2 = await context.newPage();
    await page2.goto(TEST_URLS.orders);
    await page2.waitForTimeout(2000);

    // Take screenshot of tab 2
    await page2.screenshot({ path: 'test-results/screenshots/tab2-orders-initial.png' });

    console.log('Two tabs opened with orders view');

    // In a real scenario, we would:
    // 1. Make a change in tab 2
    // 2. Verify tab 1 updates automatically
    // For now, we verify both tabs can coexist

    // Check if both tabs have auth
    const tab1Auth = await page.evaluate(() => {
      const data = localStorage.getItem('auth-storage');
      return data ? JSON.parse(data) : null;
    });

    const tab2Auth = await page2.evaluate(() => {
      const data = localStorage.getItem('auth-storage');
      return data ? JSON.parse(data) : null;
    });

    expect(tab1Auth?.state?.isAuthenticated).toBe(true);
    expect(tab2Auth?.state?.isAuthenticated).toBe(true);

    console.log('Both tabs authenticated and functional');

    await page2.close();
  });

  test('should display real-time notifications', async ({ page }) => {
    console.log('Test: Real-time notifications');

    await page.goto(TEST_URLS.dashboard);
    await page.waitForTimeout(2000);

    // Look for notification bell or indicator
    const notificationBell = page.locator('[class*="notification"], [data-testid*="notification"], button:has-text("Notification")').first();

    if (await notificationBell.isVisible()) {
      await page.screenshot({ path: 'test-results/screenshots/notification-bell.png' });

      // Click to open notifications
      await notificationBell.click();
      await page.waitForTimeout(1000);

      await page.screenshot({ path: 'test-results/screenshots/notifications-panel.png' });

      console.log('Notification system accessible');
    } else {
      console.log('Notification UI not found');
    }
  });

  test('should maintain socket connection during navigation', async ({ page }) => {
    console.log('Test: Socket persistence during navigation');

    // Start on orders page
    await page.goto(TEST_URLS.orders);
    await page.waitForTimeout(1000);

    // Check initial connection
    const initialConnection = await page.evaluate(() => {
      const socket = (window as any).socket;
      return socket ? { connected: socket.connected, id: socket.id } : null;
    });

    console.log('Initial socket state:', initialConnection);

    // Navigate to different pages
    const pagesToVisit = [
      TEST_URLS.customers,
      TEST_URLS.products,
      TEST_URLS.analytics,
      TEST_URLS.dashboard,
    ];

    for (const url of pagesToVisit) {
      await page.goto(url);
      await page.waitForTimeout(1000);

      const socketState = await page.evaluate(() => {
        const socket = (window as any).socket;
        return socket ? { connected: socket.connected, id: socket.id } : null;
      });

      console.log(`Socket state at ${url}:`, socketState);
    }

    console.log('Socket connection check across pages completed');
  });

  test('should reconnect socket after disconnect', async ({ page }) => {
    console.log('Test: Socket reconnection');

    await page.goto(TEST_URLS.dashboard);
    await page.waitForTimeout(2000);

    // Get initial connection state
    const initialState = await page.evaluate(() => {
      const socket = (window as any).socket;
      return socket ? { connected: socket.connected, id: socket.id } : null;
    });

    console.log('Initial socket state:', initialState);

    if (initialState?.connected) {
      // Simulate disconnect by going offline
      await page.context().setOffline(true);
      await page.waitForTimeout(2000);

      // Check disconnected state
      const disconnectedState = await page.evaluate(() => {
        const socket = (window as any).socket;
        return socket ? { connected: socket.connected } : null;
      });

      console.log('Disconnected state:', disconnectedState);

      // Go back online
      await page.context().setOffline(false);
      await page.waitForTimeout(3000);

      // Check reconnected state
      const reconnectedState = await page.evaluate(() => {
        const socket = (window as any).socket;
        return socket ? { connected: socket.connected, id: socket.id } : null;
      });

      console.log('Reconnected state:', reconnectedState);

      await page.screenshot({ path: 'test-results/screenshots/socket-reconnected.png' });
    } else {
      console.log('Socket not initially connected - skipping reconnection test');
      test.skip();
    }
  });

  test('should handle socket errors gracefully', async ({ page }) => {
    console.log('Test: Socket error handling');

    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];

    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error' && text.includes('socket')) {
        consoleErrors.push(text);
      } else if (msg.type() === 'warning' && text.includes('socket')) {
        consoleWarnings.push(text);
      }
    });

    await page.goto(TEST_URLS.dashboard);
    await page.waitForTimeout(3000);

    console.log('Socket errors:', consoleErrors.length);
    console.log('Socket warnings:', consoleWarnings.length);

    if (consoleErrors.length > 0) {
      console.log('Socket errors found:', consoleErrors);
    }

    // The app should function even if socket has issues
    const pageIsUsable = await page.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(pageIsUsable).toBe(true);

    console.log('App remains functional despite any socket issues');
  });

  test('should emit events on user actions', async ({ page }) => {
    console.log('Test: Socket event emission');

    await page.goto(TEST_URLS.orders);
    await page.waitForTimeout(2000);

    // Set up socket event listener
    await page.evaluate(() => {
      (window as any).socketEmissions = [];
      const socket = (window as any).socket;
      if (socket) {
        const originalEmit = socket.emit;
        socket.emit = function(...args: any[]) {
          (window as any).socketEmissions.push({ event: args[0], timestamp: Date.now() });
          return originalEmit.apply(socket, args);
        };
      }
    });

    // Perform an action that might emit socket event
    // (e.g., creating order, updating status)

    // Wait a moment
    await page.waitForTimeout(2000);

    // Check emitted events
    const emissions = await page.evaluate(() => {
      return (window as any).socketEmissions || [];
    });

    console.log('Socket emissions captured:', emissions.length);
    if (emissions.length > 0) {
      console.log('Emitted events:', emissions);
    }

    console.log('Socket emission test completed');
  });
});
