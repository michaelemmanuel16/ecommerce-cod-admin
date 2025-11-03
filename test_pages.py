#!/usr/bin/env python3
"""
Test all frontend pages and capture errors after ID migration from CUID to Int.
"""
from playwright.sync_api import sync_playwright
import json
from datetime import datetime

def test_application():
    results = {
        "test_time": datetime.now().isoformat(),
        "pages_tested": [],
        "console_errors": [],
        "network_errors": [],
        "summary": {}
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Capture console messages
        console_messages = []
        def handle_console(msg):
            if msg.type in ['error', 'warning']:
                console_messages.append({
                    "type": msg.type,
                    "text": msg.text,
                    "location": msg.location
                })
        page.on("console", handle_console)

        # Capture network failures
        network_failures = []
        def handle_response(response):
            if response.status >= 400:
                network_failures.append({
                    "url": response.url,
                    "status": response.status,
                    "status_text": response.status_text
                })
        page.on("response", handle_response)

        try:
            # Test 1: Login Page
            print("🔍 Testing Login Page...")
            page.goto('http://localhost:5173/login', wait_until='networkidle', timeout=10000)
            page.wait_for_timeout(1000)

            # Try to login (assuming test credentials)
            try:
                page.fill('input[type="email"]', 'admin@example.com')
                page.fill('input[type="password"]', 'password123')
                page.click('button[type="submit"]')
                page.wait_for_load_state('networkidle', timeout=5000)
                print("✅ Login attempt completed")
            except Exception as e:
                print(f"⚠️  Login failed or not needed: {e}")

            # List of pages to test
            pages_to_test = [
                {'name': 'Dashboard', 'url': '/'},
                {'name': 'Orders', 'url': '/orders'},
                {'name': 'Customers', 'url': '/customers'},
                {'name': 'Products', 'url': '/products'},
                {'name': 'Customer Reps', 'url': '/customer-reps'},
                {'name': 'Delivery Agents', 'url': '/delivery-agents'},
                {'name': 'Financial', 'url': '/financial'},
                {'name': 'Analytics', 'url': '/analytics'},
                {'name': 'Workflows', 'url': '/workflows'},
                {'name': 'Checkout Forms', 'url': '/checkout-forms'},
                {'name': 'Settings', 'url': '/settings'},
            ]

            for page_info in pages_to_test:
                console_before = len(console_messages)
                network_before = len(network_failures)

                print(f"\n🔍 Testing {page_info['name']}...")

                try:
                    page.goto(f"http://localhost:5173{page_info['url']}", wait_until='networkidle', timeout=10000)
                    page.wait_for_timeout(2000)  # Wait for React to render

                    # Check if page has content
                    has_content = page.locator('body').inner_text()
                    is_empty = len(has_content.strip()) < 100

                    # Check for loading indicators still present
                    loading_elements = page.locator('[class*="loading"], [class*="skeleton"]').count()

                    # Capture console errors for this page
                    page_console_errors = console_messages[console_before:]
                    page_network_errors = network_failures[network_before:]

                    page_result = {
                        "name": page_info['name'],
                        "url": page_info['url'],
                        "status": "loaded",
                        "is_empty": is_empty,
                        "loading_indicators": loading_elements,
                        "console_errors": len(page_console_errors),
                        "network_errors": len(page_network_errors),
                        "console_details": page_console_errors[:5],  # First 5 errors
                        "network_details": page_network_errors[:5]   # First 5 failures
                    }

                    if is_empty:
                        print(f"  ❌ Page appears empty (content < 100 chars)")
                    elif len(page_console_errors) > 0:
                        print(f"  ⚠️  {len(page_console_errors)} console errors")
                    elif len(page_network_errors) > 0:
                        print(f"  ⚠️  {len(page_network_errors)} network errors")
                    else:
                        print(f"  ✅ No obvious errors")

                    results["pages_tested"].append(page_result)

                except Exception as e:
                    print(f"  ❌ Failed to load: {str(e)}")
                    results["pages_tested"].append({
                        "name": page_info['name'],
                        "url": page_info['url'],
                        "status": "failed",
                        "error": str(e)
                    })

        finally:
            browser.close()

        # Compile all unique console errors
        results["console_errors"] = console_messages
        results["network_errors"] = network_failures

        # Summary
        total_pages = len(results["pages_tested"])
        failed_pages = [p for p in results["pages_tested"] if p.get("status") == "failed" or p.get("is_empty") or p.get("console_errors", 0) > 0]

        results["summary"] = {
            "total_pages_tested": total_pages,
            "pages_with_issues": len(failed_pages),
            "total_console_errors": len(console_messages),
            "total_network_errors": len(network_failures),
            "problematic_pages": [p["name"] for p in failed_pages]
        }

        return results

if __name__ == "__main__":
    print("=" * 60)
    print("🧪 E-Commerce COD Admin - Page Testing")
    print("=" * 60)

    results = test_application()

    # Save results to file
    output_file = "/Users/mac/Downloads/claude/ecommerce-cod-admin/test_results.json"
    with open(output_file, "w") as f:
        json.dump(results, f, indent=2)

    # Print summary
    print("\n" + "=" * 60)
    print("📊 TEST SUMMARY")
    print("=" * 60)
    print(f"Total pages tested: {results['summary']['total_pages_tested']}")
    print(f"Pages with issues: {results['summary']['pages_with_issues']}")
    print(f"Total console errors: {results['summary']['total_console_errors']}")
    print(f"Total network errors: {results['summary']['total_network_errors']}")

    if results['summary']['problematic_pages']:
        print(f"\n⚠️  Problematic pages:")
        for page in results['summary']['problematic_pages']:
            print(f"  - {page}")
    else:
        print("\n✅ All pages appear to be working!")

    print(f"\n📄 Full results saved to: {output_file}")
    print("=" * 60)
