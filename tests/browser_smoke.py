"""Optional UI checks: pip install playwright; CHROMIUM_PATH=/usr/bin/chromium python tests/browser_smoke.py.
Uses mocked API responses; does not spend real Gemini quota.
Start `npm run build && npm start` first. Screenshots are written under /tmp.
"""
import os, json, time
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1050}, permissions=['clipboard-read', 'clipboard-write'])
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://localhost:3000')
    page.locator('.message[role=alert]').wait_for()
    assert page.get_by_role('button',name='Generate playlist').is_disabled()
    assert 'not configured' in page.locator('.message[role=alert]').inner_text()
    assert page.request.post('http://localhost:3000/api/generate',data={'mood':'quiet','count':10}).status == 503
    state = {'used': 0, 'calls': 0, 'pending': None}
    def usage(): return {'remaining': 5-state['used'], 'limit':5, 'resetAt':'2099-01-01T00:00:00.000Z' if state['used'] else None}
    page.route('**/api/usage',lambda r:r.fulfill(json={'usage':usage()}))
    def generate(route):
        state['calls'] += 1
        state['used'] += 1
        data = route.request.post_data_json
        payload = {'title':'Somewhere between rain and remembering','description':'Soft edges and familiar voices for the long way home.','songs':[{'title':f'A song for the evening {i+1}','artist':f'Artist {i+1}'} for i in range(data['count'])], 'usage':usage()}
        if state['calls'] == 1:
            state['pending'] = (route, payload)
        else:
            route.fulfill(json=payload)
    page.route('**/api/generate',generate)
    page.route('**/api/artwork?*',lambda r:r.fulfill(json={'artwork':None}))
    page.reload()
    page.get_by_role('button',name='Generate playlist').wait_for(state='visible')
    page.wait_for_function("!document.querySelector('button[type=submit]').disabled")
    page.get_by_role('button',name='Generate playlist').click()
    assert 'Tell us' in page.locator('.message[role=alert]').inner_text()
    assert state['calls']==0
    page.get_by_role('button',name='Late-night drive').click()
    assert page.locator('textarea').input_value()=='Late-night drive'
    assert state['calls']==0
    page.get_by_role('button',name='10 songs',exact=True).click()
    page.get_by_role('button',name='Generate playlist').click()
    page.get_by_label('Generating playlist',exact=True).wait_for()
    page.wait_for_timeout(50)
    route, payload = state['pending']
    route.fulfill(json=payload)
    page.get_by_role('heading',name='Somewhere between rain and remembering').wait_for()
    assert page.locator('.song-list li').count()==10
    assert state['calls']==1
    assert page.locator('textarea').input_value()=='Late-night drive'
    assert 'A%20song' in page.locator('.spotify-link').first.get_attribute('href')
    page.get_by_role('button',name='Copy',exact=True).click()
    assert 'Playlist copied.' in page.get_by_role('status').inner_text()
    assert '1. A song for the evening 1' in page.evaluate('navigator.clipboard.readText()')
    for fmt in ['TXT','CSV']:
        page.get_by_role('button',name='Export',exact=True).click()
        with page.expect_download() as download:
            page.get_by_role('button',name=f'Download {fmt}').click()
        path = download.value.path()
        text = open(path,encoding='utf-8-sig').read()
        assert ('Position,Title,Artist' if fmt=='CSV' else 'Somewhere between rain') in text
    page.screenshot(path='/tmp/moodmix-desktop.png',full_page=True)
    for size in [{'width':390,'height':844},{'width':320,'height':700}]:
        page.set_viewport_size(size)
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
    page.screenshot(path='/tmp/moodmix-mobile.png',full_page=True)
    page.get_by_role('button',name='20 songs',exact=True).click()
    page.get_by_role('button',name='Regenerate',exact=True).click()
    page.wait_for_function("document.querySelectorAll('.song-list li').length===20")
    assert state['calls']==2
    for _ in range(3):
        with page.expect_response('**/api/generate'):
            page.get_by_role('button',name='Regenerate',exact=True).click()
        page.wait_for_function("document.querySelector('.song-list')!==null")
        page.wait_for_timeout(100)
    assert state['calls']==5
    assert page.get_by_role('button',name='Generate playlist').is_disabled()
    assert page.get_by_role('button',name='Regenerate').is_disabled()
    assert page.get_by_role('button',name='Copy',exact=True).is_enabled()
    assert '0 of 5' in page.locator('.usage').inner_text()
    assert not errors, errors
    browser.close()
    print('PASS: missing config, validation, prompts, skeleton, exact counts, Spotify links, copy, TXT/CSV downloads, regeneration, limit state, responsive widths; no browser errors.')
