"""QA Reconnaissance - Take screenshots of key pages to identify selectors"""
from playwright.sync_api import sync_playwright
import os

SCREENSHOTS_DIR = '/tmp/qa-screenshots'
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

BASE_URL = 'http://localhost:5173'
API_URL = 'http://localhost:3000'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # === 1. Login and capture admin dashboard ===
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    page.goto(f'{BASE_URL}/login')
    page.wait_for_load_state('networkidle')
    page.screenshot(path=f'{SCREENSHOTS_DIR}/01-login.png', full_page=True)

    # Login
    page.fill('input[type="email"]', 'admin@codadmin.com')
    page.fill('input[type="password"]', 'password123')
    page.click('button[type="submit"]')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)
    page.screenshot(path=f'{SCREENSHOTS_DIR}/02-dashboard.png', full_page=True)
    print(f"Dashboard URL: {page.url}")

    # === 2. Navigate to Products page (digital products - PR #157) ===
    page.goto(f'{BASE_URL}/products')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    page.screenshot(path=f'{SCREENSHOTS_DIR}/03-products.png', full_page=True)
    print(f"Products URL: {page.url}")

    # === 3. Navigate to Checkout Forms (PR #158) ===
    page.goto(f'{BASE_URL}/checkout-forms')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    page.screenshot(path=f'{SCREENSHOTS_DIR}/04-checkout-forms.png', full_page=True)
    print(f"Checkout Forms URL: {page.url}")

    # === 4. Navigate to Orders page ===
    page.goto(f'{BASE_URL}/orders')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    page.screenshot(path=f'{SCREENSHOTS_DIR}/05-orders.png', full_page=True)
    print(f"Orders URL: {page.url}")

    # === 5. Navigate to Settings ===
    page.goto(f'{BASE_URL}/settings')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    page.screenshot(path=f'{SCREENSHOTS_DIR}/06-settings.png', full_page=True)
    print(f"Settings URL: {page.url}")

    # === 6. Check a public checkout form ===
    page2 = browser.new_page(viewport={'width': 1280, 'height': 800})
    page2.goto(f'{BASE_URL}/checkout/test')
    page2.wait_for_load_state('networkidle')
    page2.wait_for_timeout(1000)
    page2.screenshot(path=f'{SCREENSHOTS_DIR}/07-public-checkout.png', full_page=True)
    print(f"Public checkout URL: {page2.url}")
    page2.close()

    # === 7. Check tenant registration page ===
    page3 = browser.new_page(viewport={'width': 1280, 'height': 800})
    page3.goto(f'{BASE_URL}/register')
    page3.wait_for_load_state('networkidle')
    page3.wait_for_timeout(1000)
    page3.screenshot(path=f'{SCREENSHOTS_DIR}/08-register.png', full_page=True)
    print(f"Register URL: {page3.url}")
    page3.close()

    # === 8. Check security headers (PR #160) ===
    import requests
    print("\n=== Security Headers Check ===")
    resp = requests.get(f'{API_URL}/api/health', timeout=5)
    headers = dict(resp.headers)
    security_headers = [
        'x-content-type-options', 'x-frame-options', 'x-xss-protection',
        'strict-transport-security', 'content-security-policy',
        'x-dns-prefetch-control', 'x-download-options',
        'x-permitted-cross-domain-policies', 'referrer-policy'
    ]
    for h in security_headers:
        val = headers.get(h, 'MISSING')
        status = 'OK' if val != 'MISSING' else 'MISSING'
        print(f"  [{status}] {h}: {val}")

    browser.close()
    print(f"\nScreenshots saved to {SCREENSHOTS_DIR}/")
    print("Recon complete.")
