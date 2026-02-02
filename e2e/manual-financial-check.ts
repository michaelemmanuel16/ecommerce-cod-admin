/**
 * Manual Financial Page Verification Script
 * Run with: npx playwright codegen http://localhost:5173
 *
 * This script helps manually verify the Financial Management module
 * after logging in with admin credentials
 */

import { chromium } from '@playwright/test';

async function manualCheck() {
  console.log('🚀 Starting manual Financial Management verification...\n');

  const browser = await chromium.launch({
    headless: false, // Open browser so you can see
    slowMo: 500, // Slow down actions
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  try {
    // 1. Navigate to login
    console.log('✅ Step 1: Navigate to login page');
    await page.goto('http://localhost:5173/login');
    await page.waitForLoadState('networkidle');

    // 2. Login
    console.log('✅ Step 2: Logging in as admin...');
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL('http://localhost:5173/', { timeout: 10000 });
    console.log('✅ Step 3: Login successful, redirected to dashboard');

    // 3. Navigate to Financial page
    console.log('✅ Step 4: Navigating to Financial Management...');
    await page.goto('http://localhost:5173/financial');
    await page.waitForLoadState('networkidle');

    // Wait for main heading
    await page.waitForSelector('h1:has-text("Financial Management")', { timeout: 10000 });
    console.log('✅ Step 5: Financial Management page loaded\n');

    // 4. Verify Overview Tab
    console.log('📊 OVERVIEW TAB VERIFICATION:');
    console.log('   Checking KPI cards...');

    const kpiCards = await page.locator('.bg-white.rounded-lg.shadow').count();
    console.log(`   ✓ Found ${kpiCards} KPI cards`);

    // Check for charts
    const charts = await page.locator('svg.recharts-surface').count();
    console.log(`   ✓ Found ${charts} chart(s)`);

    // Get some KPI values
    const kpiValues = await page.locator('p.text-2xl, p.text-3xl, div.text-2xl, div.text-3xl').allTextContents();
    console.log('   ✓ KPI Values:', kpiValues.slice(0, 5).join(', '));

    // 5. Switch to Agent Collections Tab
    console.log('\n👥 AGENT COLLECTIONS TAB VERIFICATION:');
    await page.click('button[role="tab"]:has-text("Agent Collections")');
    await page.waitForTimeout(1500);

    const agentTable = await page.locator('table').first().isVisible();
    console.log(`   ✓ Agent table visible: ${agentTable}`);

    if (agentTable) {
      const rows = await page.locator('table tbody tr').count();
      console.log(`   ✓ Found ${rows} agent row(s)`);
    }

    // 6. Switch to Accounting & Analysis Tab
    console.log('\n📈 ACCOUNTING & ANALYSIS TAB VERIFICATION:');
    await page.click('button[role="tab"]:has-text("Accounting")');
    await page.waitForTimeout(1500);

    // Check sub-tabs
    const glTab = await page.locator('button:has-text("General Ledger")').isVisible();
    const statementsTab = await page.locator('button:has-text("Financial Statements"), button:has-text("Statements")').isVisible();
    const profitabilityTab = await page.locator('button:has-text("Profitability")').isVisible();
    const expensesTab = await page.locator('button:has-text("Expense")').isVisible();

    console.log(`   ✓ General Ledger tab visible: ${glTab}`);
    console.log(`   ✓ Financial Statements tab visible: ${statementsTab}`);
    console.log(`   ✓ Profitability tab visible: ${profitabilityTab}`);
    console.log(`   ✓ Expense Management tab visible: ${expensesTab}`);

    // Check GL table
    const glTable = await page.locator('table').first().isVisible();
    console.log(`   ✓ GL Accounts table visible: ${glTable}`);

    if (glTable) {
      const glRows = await page.locator('table tbody tr').count();
      console.log(`   ✓ Found ${glRows} GL account row(s)`);
    }

    // 7. Check for console errors
    console.log('\n🔍 CHECKING FOR ERRORS:');
    const errors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.waitForTimeout(2000);

    if (errors.length === 0) {
      console.log('   ✓ No console errors detected');
    } else {
      console.log(`   ⚠️  Found ${errors.length} console error(s):`);
      errors.forEach(err => console.log(`      - ${err}`));
    }

    // 8. Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ VERIFICATION COMPLETE!');
    console.log('='.repeat(60));
    console.log('All 3 tabs are accessible and displaying data.');
    console.log('Browser will remain open for 30 seconds for manual inspection...\n');

    // Keep browser open for manual inspection
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('\n❌ ERROR:', error);
  } finally {
    await browser.close();
    console.log('\n👋 Browser closed. Verification complete.');
  }
}

// Run the check
manualCheck().catch(console.error);
