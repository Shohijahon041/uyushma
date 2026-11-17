import sys
from playwright.sync_api import sync_playwright

sso_url = "https://sso.egov.uz/sso/oauth/Authorization.do?response_type=one_code&client_id=e-tender_uztrans_uz&redirect_uri=https://e-tender.uztrans.uz&scope=e-tender_uztrans_uz&state=e-tender_uztrans_uz"

print(f"Opening SSO: {sso_url}")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
    page = browser.new_page()
    page.goto(sso_url, timeout=30000, wait_until="domcontentloaded")
    print(f"Final URL: {page.url}")
    inputs = page.query_selector_all("input")
    for inp in inputs:
        name = inp.get_attribute("name")
        typ = inp.get_attribute("type")
        iid = inp.get_attribute("id")
        placeholder = inp.get_attribute("placeholder")
        print(f"Input: name={name}, type={typ}, id={iid}, placeholder={placeholder}")
    buttons = page.query_selector_all("button, input[type='submit']")
    for btn in buttons:
        txt = btn.inner_text() if btn.tag_name == "button" else btn.get_attribute("value")
        print(f"Button: tag={btn.tag_name}, text={txt}, type={btn.get_attribute('type')}")
    browser.close()

