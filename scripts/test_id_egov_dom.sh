#!/bin/bash
su -s /bin/bash uyushma << 'EOF'
HOME=/opt/uyushma /opt/uyushma/app/collector_service/.venv/bin/python << 'PYEOF'
import sys
from playwright.sync_api import sync_playwright

sso_url = "https://sso.egov.uz/sso/oauth/Authorization.do?response_type=one_code&client_id=e-tender_uztrans_uz&redirect_uri=https://e-tender.uztrans.uz&scope=e-tender_uztrans_uz&state=e-tender_uztrans_uz"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
    page = browser.new_page()
    page.goto(sso_url, timeout=30000, wait_until="networkidle")
    print(f"Final URL: {page.url}")
    # wait 2 seconds for JS rendering
    page.wait_for_timeout(2000)
    
    inputs = page.query_selector_all("input")
    print(f"Total inputs found: {len(inputs)}")
    for inp in inputs:
        name = inp.get_attribute("name")
        typ = inp.get_attribute("type")
        iid = inp.get_attribute("id")
        placeholder = inp.get_attribute("placeholder")
        cls = inp.get_attribute("class")
        print(f"Input: name={name}, type={typ}, id={iid}, placeholder={placeholder}, class={cls}")

    buttons = page.query_selector_all("button, input[type='submit']")
    print(f"Total buttons found: {len(buttons)}")
    for btn in buttons:
        txt = btn.inner_text().strip().replace('\n', ' ')
        btyp = btn.get_attribute("type")
        cls = btn.get_attribute("class")
        print(f"Button: text='{txt}', type={btyp}, class={cls}")
        
    browser.close()
PYEOF
EOF

