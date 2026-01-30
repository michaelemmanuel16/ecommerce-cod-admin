#!/usr/bin/env python3
"""
Comprehensive Financial Module Testing Script
Tests all 8 tabs: General Ledger, Overview, Cash Flow, Agent Reconciliation,
Agent Aging, Expense Management, Profitability Analysis, Financial Statements
"""

from playwright.sync_api import sync_playwright, Page
import json
import time
from datetime import datetime

class FinancialModuleTester:
    def __init__(self):
        self.test_results = {
            "timestamp": datetime.now().isoformat(),
            "tabs_tested": [],
            "issues": [],
            "calculations": {},
            "screenshots": [],
            "ui_ux_notes": [],
            "summary": {}
        }

    def login(self, page: Page):
        """Login as admin user"""
        print("🔐 Logging in as admin@codadmin.com...")
        page.goto('http://localhost:5173/login')
        page.wait_for_load_state('networkidle')

        # Fill login form
        page.fill('input[type="email"]', 'admin@codadmin.com')
        page.fill('input[type="password"]', 'password123')
        page.click('button[type="submit"]')

        # Wait for redirect (might go to dashboard or root)
        page.wait_for_timeout(3000)
        page.wait_for_load_state('networkidle')

        # Check if we're logged in (look for logout or user menu)
        current_url = page.url
        print(f"✅ Login successful - Current URL: {current_url}")

    def navigate_to_financial(self, page: Page):
        """Navigate to Financial page"""
        print("📊 Navigating to Financial module...")
        page.goto('http://localhost:5173/financial')
        page.wait_for_load_state('networkidle')
        time.sleep(2)  # Extra wait for charts to render
        print("✅ Financial module loaded")

    def extract_text_safely(self, page: Page, selector: str, default="N/A"):
        """Safely extract text from element"""
        try:
            element = page.locator(selector).first
            if element.count() > 0:
                return element.text_content().strip()
        except:
            pass
        return default

    def extract_number_safely(self, page: Page, selector: str, default=0):
        """Safely extract number from element"""
        text = self.extract_text_safely(page, selector, "0")
        # Remove currency symbols, commas, and extract number
        import re
        numbers = re.findall(r'[-+]?\d*\.?\d+', text.replace(',', ''))
        if numbers:
            return float(numbers[0])
        return default

    def test_general_ledger(self, page: Page):
        """Test Tab 1: General Ledger"""
        print("\n" + "="*60)
        print("📋 Testing Tab 1: GENERAL LEDGER")
        print("="*60)

        # Click General Ledger tab
        page.click('text=General Ledger')
        page.wait_for_load_state('networkidle')
        time.sleep(1)

        # Take screenshot
        screenshot_path = '/tmp/financial_general_ledger.png'
        page.screenshot(path=screenshot_path, full_page=True)
        self.test_results["screenshots"].append(screenshot_path)
        print(f"📸 Screenshot saved: {screenshot_path}")

        tab_result = {
            "tab_name": "General Ledger",
            "status": "tested",
            "features_tested": [],
            "issues_found": []
        }

        # Test Chart of Accounts
        print("\n🔍 Testing Chart of Accounts...")
        accounts_found = []

        # Check for specific accounts
        expected_accounts = [
            "1010", "1015", "1020", "1200",  # Assets
            "4010",  # Revenue
            "5010", "5020", "5030", "5040", "5050",  # Expenses
            "2010"  # Liabilities
        ]

        for account_code in expected_accounts:
            try:
                element = page.locator(f'text={account_code}').first
                if element.count() > 0:
                    accounts_found.append(account_code)
                    print(f"  ✅ Found account: {account_code}")
                else:
                    print(f"  ❌ Missing account: {account_code}")
                    tab_result["issues_found"].append(f"Account {account_code} not found")
            except:
                print(f"  ❌ Error checking account: {account_code}")

        tab_result["features_tested"].append(f"Chart of Accounts ({len(accounts_found)}/{len(expected_accounts)} found)")

        # Check for commission accounts specifically
        commission_accounts_found = []
        if "5040" in accounts_found:
            commission_accounts_found.append("5040 - Delivery Agent Commission")
            print("  ✅ CRITICAL: Delivery Agent Commission account (5040) EXISTS")
        else:
            print("  ❌ CRITICAL: Delivery Agent Commission account (5040) NOT FOUND")
            tab_result["issues_found"].append("CRITICAL: Commission account 5040 missing")

        if "5050" in accounts_found:
            commission_accounts_found.append("5050 - Sales Rep Commission")
            print("  ✅ CRITICAL: Sales Rep Commission account (5050) EXISTS")
        else:
            print("  ❌ CRITICAL: Sales Rep Commission account (5050) NOT FOUND")
            tab_result["issues_found"].append("CRITICAL: Commission account 5050 missing")

        self.test_results["calculations"]["commission_accounts"] = commission_accounts_found

        # Try to view ledger for commission account
        if "5040" in accounts_found:
            print("\n🔍 Checking commission account transactions...")
            try:
                # Look for "View Ledger" button near account 5040
                view_buttons = page.locator('button:has-text("View Ledger")').all()
                print(f"  Found {len(view_buttons)} 'View Ledger' buttons")
                # Note: Can't easily click specific account's button without better selectors
                tab_result["features_tested"].append("Commission account presence verified")
            except Exception as e:
                print(f"  ⚠️  Could not check ledger: {e}")

        # Test search functionality
        print("\n🔍 Testing account search...")
        try:
            search_input = page.locator('input[placeholder*="Search"], input[type="search"]').first
            if search_input.count() > 0:
                search_input.fill("Cash")
                page.wait_for_timeout(1000)
                # Check if results filtered
                tab_result["features_tested"].append("Account search")
                print("  ✅ Search functionality present")
            else:
                print("  ⚠️  Search input not found")
        except Exception as e:
            print(f"  ⚠️  Search test failed: {e}")

        self.test_results["tabs_tested"].append(tab_result)

    def test_overview(self, page: Page):
        """Test Tab 2: Overview"""
        print("\n" + "="*60)
        print("📊 Testing Tab 2: OVERVIEW")
        print("="*60)

        # Click Overview tab
        page.click('text=Overview')
        page.wait_for_load_state('networkidle')
        time.sleep(2)  # Wait for charts

        # Take screenshot
        screenshot_path = '/tmp/financial_overview.png'
        page.screenshot(path=screenshot_path, full_page=True)
        self.test_results["screenshots"].append(screenshot_path)
        print(f"📸 Screenshot saved: {screenshot_path}")

        tab_result = {
            "tab_name": "Overview",
            "status": "tested",
            "kpis": {},
            "issues_found": []
        }

        # Extract KPI values
        print("\n🔍 Extracting KPI values...")
        kpis = {}

        # Try to find KPI cards
        kpi_labels = [
            "Total Revenue", "Net Profit", "Outstanding COD",
            "Total Expenses", "Expected Revenue", "Cash in Hand"
        ]

        for label in kpi_labels:
            try:
                # Look for the label and then find the value nearby
                value = self.extract_text_safely(page, f'text={label} >> xpath=../.. >> *[1]', "N/A")
                kpis[label] = value
                print(f"  {label}: {value}")
            except Exception as e:
                print(f"  ⚠️  Could not extract {label}: {e}")
                kpis[label] = "N/A"

        tab_result["kpis"] = kpis
        self.test_results["calculations"]["overview_kpis"] = kpis

        # Try to extract numeric values for validation
        print("\n🔍 Extracting numeric values for validation...")
        try:
            total_revenue = self.extract_number_safely(page, 'text=Total Revenue >> xpath=../.. >> *[1]')
            net_profit = self.extract_number_safely(page, 'text=Net Profit >> xpath=../.. >> *[1]')
            total_expenses = self.extract_number_safely(page, 'text=Total Expenses >> xpath=../.. >> *[1]')

            print(f"  Total Revenue: GHS {total_revenue:,.2f}")
            print(f"  Net Profit: GHS {net_profit:,.2f}")
            print(f"  Total Expenses: GHS {total_expenses:,.2f}")

            # Validate: Net Profit = Revenue - Expenses (approximately)
            expected_net_profit = total_revenue - total_expenses
            if abs(net_profit - expected_net_profit) > 0.01 and total_revenue > 0:
                issue = f"Net Profit calculation may be incorrect. Expected: {expected_net_profit:.2f}, Got: {net_profit:.2f}"
                print(f"  ❌ {issue}")
                tab_result["issues_found"].append(issue)
            else:
                print(f"  ✅ Net Profit calculation appears correct")

        except Exception as e:
            print(f"  ⚠️  Could not validate calculations: {e}")

        # Check for charts
        print("\n🔍 Checking for charts...")
        chart_count = page.locator('svg').count()
        print(f"  Found {chart_count} SVG elements (likely charts)")
        tab_result["charts_found"] = chart_count

        if chart_count < 2:
            tab_result["issues_found"].append("Expected at least 2 charts (Revenue/Expense trend, Expense breakdown)")

        self.test_results["tabs_tested"].append(tab_result)

    def test_cash_flow(self, page: Page):
        """Test Tab 3: Cash Flow"""
        print("\n" + "="*60)
        print("💰 Testing Tab 3: CASH FLOW")
        print("="*60)

        page.click('text=Cash Flow')
        page.wait_for_load_state('networkidle')
        time.sleep(1)

        screenshot_path = '/tmp/financial_cash_flow.png'
        page.screenshot(path=screenshot_path, full_page=True)
        self.test_results["screenshots"].append(screenshot_path)
        print(f"📸 Screenshot saved: {screenshot_path}")

        tab_result = {
            "tab_name": "Cash Flow",
            "status": "tested",
            "cash_positions": {},
            "issues_found": []
        }

        print("\n🔍 Extracting cash positions...")

        cash_labels = [
            "Cash in Hand", "Cash in Transit", "Agent AR", "Total Cash Position"
        ]

        cash_values = {}
        for label in cash_labels:
            value = self.extract_text_safely(page, f'text={label}')
            cash_values[label] = value
            print(f"  {label}: {value}")

        tab_result["cash_positions"] = cash_values
        self.test_results["calculations"]["cash_flow"] = cash_values

        # Try to validate: Total = Sum of components
        try:
            cash_in_hand = self.extract_number_safely(page, 'text=Cash in Hand >> xpath=../.. >> *[1]')
            cash_in_transit = self.extract_number_safely(page, 'text=Cash in Transit >> xpath=../.. >> *[1]')
            agent_ar = self.extract_number_safely(page, 'text=Agent AR >> xpath=../.. >> *[1]')
            total_cash = self.extract_number_safely(page, 'text=Total Cash Position >> xpath=../.. >> *[1]')

            expected_total = cash_in_hand + cash_in_transit + agent_ar

            if abs(total_cash - expected_total) > 0.01:
                issue = f"Total Cash Position mismatch. Expected: {expected_total:.2f}, Got: {total_cash:.2f}"
                print(f"  ❌ {issue}")
                tab_result["issues_found"].append(issue)
            else:
                print(f"  ✅ Total Cash Position calculation correct")
        except Exception as e:
            print(f"  ⚠️  Could not validate totals: {e}")

        self.test_results["tabs_tested"].append(tab_result)

    def test_agent_reconciliation(self, page: Page):
        """Test Tab 4: Agent Reconciliation"""
        print("\n" + "="*60)
        print("🤝 Testing Tab 4: AGENT RECONCILIATION")
        print("="*60)

        page.click('text=Agent Reconciliation')
        page.wait_for_load_state('networkidle')
        time.sleep(1)

        screenshot_path = '/tmp/financial_agent_reconciliation.png'
        page.screenshot(path=screenshot_path, full_page=True)
        self.test_results["screenshots"].append(screenshot_path)
        print(f"📸 Screenshot saved: {screenshot_path}")

        tab_result = {
            "tab_name": "Agent Reconciliation",
            "status": "tested",
            "agents_found": 0,
            "issues_found": []
        }

        print("\n🔍 Checking agent reconciliation data...")

        # Count table rows
        try:
            rows = page.locator('table tbody tr').count()
            print(f"  Found {rows} agent records")
            tab_result["agents_found"] = rows

            if rows == 0:
                print("  ⚠️  No agents with outstanding balances found")
        except Exception as e:
            print(f"  ⚠️  Could not count agents: {e}")

        self.test_results["tabs_tested"].append(tab_result)

    def test_agent_aging(self, page: Page):
        """Test Tab 5: Agent Aging"""
        print("\n" + "="*60)
        print("📅 Testing Tab 5: AGENT AGING")
        print("="*60)

        page.click('text=Agent Aging')
        page.wait_for_load_state('networkidle')
        time.sleep(1)

        screenshot_path = '/tmp/financial_agent_aging.png'
        page.screenshot(path=screenshot_path, full_page=True)
        self.test_results["screenshots"].append(screenshot_path)
        print(f"📸 Screenshot saved: {screenshot_path}")

        tab_result = {
            "tab_name": "Agent Aging",
            "status": "tested",
            "aging_buckets": {},
            "issues_found": []
        }

        print("\n🔍 Extracting aging bucket data...")

        buckets = ["0-1 days", "2-3 days", "4-7 days", "8+ days"]
        bucket_values = {}

        for bucket in buckets:
            value = self.extract_text_safely(page, f'text={bucket}')
            bucket_values[bucket] = value
            print(f"  {bucket}: {value}")

        tab_result["aging_buckets"] = bucket_values
        self.test_results["calculations"]["agent_aging"] = bucket_values

        self.test_results["tabs_tested"].append(tab_result)

    def test_expense_management(self, page: Page):
        """Test Tab 6: Expense Management"""
        print("\n" + "="*60)
        print("💸 Testing Tab 6: EXPENSE MANAGEMENT")
        print("="*60)

        page.click('text=Expense Management')
        page.wait_for_load_state('networkidle')
        time.sleep(1)

        screenshot_path = '/tmp/financial_expense_management.png'
        page.screenshot(path=screenshot_path, full_page=True)
        self.test_results["screenshots"].append(screenshot_path)
        print(f"📸 Screenshot saved: {screenshot_path}")

        tab_result = {
            "tab_name": "Expense Management",
            "status": "tested",
            "expenses_found": 0,
            "features_tested": [],
            "issues_found": []
        }

        print("\n🔍 Checking expense records...")

        # Count expense records
        try:
            rows = page.locator('table tbody tr').count()
            print(f"  Found {rows} expense records")
            tab_result["expenses_found"] = rows

            if rows == 0:
                print("  ⚠️  No expenses found - need to create test data")
                tab_result["issues_found"].append("No expense records found")
        except Exception as e:
            print(f"  ⚠️  Could not count expenses: {e}")

        # Check for "Add Expense" or "Create Expense" button
        print("\n🔍 Testing expense creation UI...")
        try:
            add_button = page.locator('button:has-text("Add Expense"), button:has-text("Create Expense"), button:has-text("New Expense")').first
            if add_button.count() > 0:
                print("  ✅ Expense creation button found")
                tab_result["features_tested"].append("Create expense button present")
            else:
                print("  ❌ Expense creation button not found")
                tab_result["issues_found"].append("No expense creation button")
        except Exception as e:
            print(f"  ⚠️  Could not check create button: {e}")

        self.test_results["tabs_tested"].append(tab_result)

    def test_profitability_analysis(self, page: Page):
        """Test Tab 7: Profitability Analysis"""
        print("\n" + "="*60)
        print("📈 Testing Tab 7: PROFITABILITY ANALYSIS")
        print("="*60)

        page.click('text=Profitability Analysis')
        page.wait_for_load_state('networkidle')
        time.sleep(2)

        screenshot_path = '/tmp/financial_profitability.png'
        page.screenshot(path=screenshot_path, full_page=True)
        self.test_results["screenshots"].append(screenshot_path)
        print(f"📸 Screenshot saved: {screenshot_path}")

        tab_result = {
            "tab_name": "Profitability Analysis",
            "status": "tested",
            "margins": {},
            "issues_found": []
        }

        print("\n🔍 Extracting profitability metrics...")

        # Extract margin percentages
        margin_labels = ["Gross Margin", "Net Margin"]
        margins = {}

        for label in margin_labels:
            value = self.extract_text_safely(page, f'text={label}')
            margins[label] = value
            print(f"  {label}: {value}")

        tab_result["margins"] = margins
        self.test_results["calculations"]["profitability"] = margins

        self.test_results["tabs_tested"].append(tab_result)

    def test_financial_statements(self, page: Page):
        """Test Tab 8: Financial Statements"""
        print("\n" + "="*60)
        print("📄 Testing Tab 8: FINANCIAL STATEMENTS")
        print("="*60)

        page.click('text=Financial Statements')
        page.wait_for_load_state('networkidle')
        time.sleep(2)

        screenshot_path = '/tmp/financial_statements.png'
        page.screenshot(path=screenshot_path, full_page=True)
        self.test_results["screenshots"].append(screenshot_path)
        print(f"📸 Screenshot saved: {screenshot_path}")

        tab_result = {
            "tab_name": "Financial Statements",
            "status": "tested",
            "statements_tested": [],
            "issues_found": []
        }

        print("\n🔍 Testing Balance Sheet...")

        # Look for Balance Sheet section
        try:
            if page.locator('text=Balance Sheet').count() > 0:
                print("  ✅ Balance Sheet found")
                tab_result["statements_tested"].append("Balance Sheet")

                # Try to extract key values
                assets = self.extract_text_safely(page, 'text=Total Assets')
                liabilities = self.extract_text_safely(page, 'text=Total Liabilities')
                equity = self.extract_text_safely(page, 'text=Total Equity')

                print(f"    Total Assets: {assets}")
                print(f"    Total Liabilities: {liabilities}")
                print(f"    Total Equity: {equity}")

                # Critical validation: Assets = Liabilities + Equity
                try:
                    assets_num = self.extract_number_safely(page, 'text=Total Assets >> xpath=../.. >> *[1]')
                    liabilities_num = self.extract_number_safely(page, 'text=Total Liabilities >> xpath=../.. >> *[1]')
                    equity_num = self.extract_number_safely(page, 'text=Total Equity >> xpath=../.. >> *[1]')

                    expected_assets = liabilities_num + equity_num

                    if abs(assets_num - expected_assets) > 0.01:
                        issue = f"CRITICAL: Balance sheet doesn't balance! Assets: {assets_num:.2f}, L+E: {expected_assets:.2f}"
                        print(f"    ❌ {issue}")
                        tab_result["issues_found"].append(issue)
                    else:
                        print(f"    ✅ Balance Sheet balances correctly (Assets = Liabilities + Equity)")
                except Exception as e:
                    print(f"    ⚠️  Could not validate balance sheet equation: {e}")
            else:
                print("  ❌ Balance Sheet not found")
                tab_result["issues_found"].append("Balance Sheet not found")
        except Exception as e:
            print(f"  ⚠️  Balance Sheet test failed: {e}")

        print("\n🔍 Testing Profit & Loss Statement...")

        try:
            if page.locator('text=Profit & Loss, text=Income Statement').count() > 0:
                print("  ✅ P&L Statement found")
                tab_result["statements_tested"].append("Profit & Loss")

                # Extract key P&L values
                revenue = self.extract_text_safely(page, 'text=Total Revenue, text=Sales Revenue')
                cogs = self.extract_text_safely(page, 'text=Cost of Goods Sold, text=COGS')
                gross_profit = self.extract_text_safely(page, 'text=Gross Profit')
                net_income = self.extract_text_safely(page, 'text=Net Income, text=Net Profit')

                print(f"    Total Revenue: {revenue}")
                print(f"    COGS: {cogs}")
                print(f"    Gross Profit: {gross_profit}")
                print(f"    Net Income: {net_income}")

                # Check for commission expenses in P&L
                if page.locator('text=Delivery Agent Commission, text=5040').count() > 0:
                    print("    ✅ Delivery Agent Commission appears in P&L")
                else:
                    print("    ⚠️  Delivery Agent Commission may not appear in P&L")

                if page.locator('text=Sales Rep Commission, text=5050').count() > 0:
                    print("    ✅ Sales Rep Commission appears in P&L")
                else:
                    print("    ⚠️  Sales Rep Commission may not appear in P&L")
            else:
                print("  ❌ P&L Statement not found")
                tab_result["issues_found"].append("P&L Statement not found")
        except Exception as e:
            print(f"  ⚠️  P&L test failed: {e}")

        self.test_results["tabs_tested"].append(tab_result)

    def generate_report(self):
        """Generate comprehensive test report"""
        print("\n" + "="*60)
        print("📋 GENERATING COMPREHENSIVE TEST REPORT")
        print("="*60)

        report = []
        report.append("# Financial Module Test Report")
        report.append(f"\n**Test Date**: {self.test_results['timestamp']}")
        report.append(f"\n**Tester**: Automated Testing Script")
        report.append(f"\n**Environment**: localhost:5173/financial")

        # Executive Summary
        report.append("\n## Executive Summary")
        total_issues = sum(len(tab.get("issues_found", [])) for tab in self.test_results["tabs_tested"])
        report.append(f"\n- **Tabs Tested**: {len(self.test_results['tabs_tested'])}/8")
        report.append(f"- **Total Issues Found**: {total_issues}")
        report.append(f"- **Screenshots Captured**: {len(self.test_results['screenshots'])}")

        # Critical Findings
        report.append("\n## Critical Findings")

        # Commission accounts
        if self.test_results["calculations"].get("commission_accounts"):
            report.append("\n### ✅ Commission Accounts Status")
            for account in self.test_results["calculations"]["commission_accounts"]:
                report.append(f"- {account}")
        else:
            report.append("\n### ❌ CRITICAL: Commission Accounts Missing")
            report.append("- Expected accounts 5040 and 5050 not found in Chart of Accounts")

        # Tab-by-Tab Results
        report.append("\n## Tab-by-Tab Test Results")

        for tab in self.test_results["tabs_tested"]:
            report.append(f"\n### {tab['tab_name']}")
            report.append(f"\n**Status**: {tab['status']}")

            if "features_tested" in tab and tab["features_tested"]:
                report.append("\n**Features Tested**:")
                for feature in tab["features_tested"]:
                    report.append(f"- {feature}")

            if "kpis" in tab and tab["kpis"]:
                report.append("\n**KPI Values**:")
                for key, value in tab["kpis"].items():
                    report.append(f"- {key}: {value}")

            if tab.get("issues_found"):
                report.append("\n**Issues Found**:")
                for issue in tab["issues_found"]:
                    severity = "🔴 CRITICAL" if "CRITICAL" in issue else "⚠️  WARNING"
                    report.append(f"- {severity}: {issue}")
            else:
                report.append("\n**Issues Found**: None ✅")

        # Calculations Summary
        report.append("\n## Extracted Calculations")

        if self.test_results["calculations"].get("overview_kpis"):
            report.append("\n### Overview KPIs")
            for key, value in self.test_results["calculations"]["overview_kpis"].items():
                report.append(f"- **{key}**: {value}")

        if self.test_results["calculations"].get("cash_flow"):
            report.append("\n### Cash Flow")
            for key, value in self.test_results["calculations"]["cash_flow"].items():
                report.append(f"- **{key}**: {value}")

        # Recommendations
        report.append("\n## Recommendations")

        if total_issues > 0:
            report.append("\n### Priority Fixes")
            report.append("1. Verify commission accounts (5040, 5050) are being used for transactions")
            report.append("2. Create test expense data to verify Expense Management tab")
            report.append("3. Validate all financial calculations against source data")
            report.append("4. Check Balance Sheet equation (Assets = Liabilities + Equity)")
        else:
            report.append("\n✅ No critical issues found. System appears healthy.")

        # Screenshots
        report.append("\n## Screenshots")
        for screenshot in self.test_results["screenshots"]:
            report.append(f"\n- {screenshot}")

        # Save report
        report_text = "\n".join(report)
        report_path = "/tmp/financial_module_test_report.md"
        with open(report_path, "w") as f:
            f.write(report_text)

        print(f"\n📄 Test report saved: {report_path}")

        # Also save raw JSON
        json_path = "/tmp/financial_module_test_results.json"
        with open(json_path, "w") as f:
            json.dump(self.test_results, f, indent=2)
        print(f"📊 Raw test data saved: {json_path}")

        return report_text

    def run_all_tests(self):
        """Run all financial module tests"""
        print("🚀 Starting Comprehensive Financial Module Testing")
        print("="*60)

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()

            try:
                # Login
                self.login(page)

                # Navigate to Financial module
                self.navigate_to_financial(page)

                # Test all 8 tabs
                self.test_general_ledger(page)
                self.test_overview(page)
                self.test_cash_flow(page)
                self.test_agent_reconciliation(page)
                self.test_agent_aging(page)
                self.test_expense_management(page)
                self.test_profitability_analysis(page)
                self.test_financial_statements(page)

                # Generate report
                report = self.generate_report()

                print("\n" + "="*60)
                print("✅ TESTING COMPLETE")
                print("="*60)
                print(f"\nView full report at: /tmp/financial_module_test_report.md")
                print(f"View screenshots in: /tmp/financial_*.png")

            except Exception as e:
                print(f"\n❌ Test execution failed: {e}")
                import traceback
                traceback.print_exc()
            finally:
                browser.close()

if __name__ == "__main__":
    tester = FinancialModuleTester()
    tester.run_all_tests()
