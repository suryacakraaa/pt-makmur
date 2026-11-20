import asyncio, os
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(
            viewport={'width': 393, 'height': 852},
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
        )
        file_path = os.path.abspath('index.html').replace('\\', '/')
        await page.goto(f'file:///{file_path}')
        await page.wait_for_timeout(800)
        
        # Login
        await page.fill('#loginUsername', 'PTMAKMUR')
        await page.fill('#loginPassword', 'jayabersama')
        await page.click('#btnLogin')
        await page.wait_for_timeout(600)
        
        # Open mobile menu to go to modal
        await page.click('#mobileMenuBtn')
        await page.wait_for_timeout(300)
        await page.click('a[data-page="modal"]')
        await page.wait_for_timeout(400)
        
        await page.click('#btnAddModal')
        await page.select_option('#modal-founder', 'VISUNA')
        await page.click('#btnAddModal')
        await page.select_option('#modal-founder', 'AVON')
        await page.click('#btnAddModal')
        await page.wait_for_timeout(400)
        
        # Open mobile menu to go to proxy
        await page.click('#mobileMenuBtn')
        await page.wait_for_timeout(300)
        await page.click('a[data-page="proxy"]')
        await page.wait_for_timeout(400)
        await page.click('#btnAddProxy')
        await page.wait_for_timeout(400)
        
        # Open mobile menu to go to dashboard
        await page.click('#mobileMenuBtn')
        await page.wait_for_timeout(300)
        await page.click('a[data-page="dashboard"]')
        await page.wait_for_timeout(600)
        
        artifact_path = r'C:/Users/Surya/.gemini/antigravity/brain/b16b0deb-18b8-4cca-8cd8-87431bc7fffa/mobile_dashboard_new.png'
        await page.screenshot(path=artifact_path)
        print('Saved mobile screenshot to artifact path!')
        await browser.close()

asyncio.run(run())
