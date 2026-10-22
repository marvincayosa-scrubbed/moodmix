"""Optional UI checks: pip install playwright; CHROMIUM_PATH=/usr/bin/chromium python tests/browser_smoke.py.
Uses mocked API responses; does not spend real Gemini quota.
Start `npm run build && npm start` first. Screenshots are written under /tmp.
"""
import os
from urllib.parse import urlsplit, parse_qs
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
    state = {'calls': 0, 'pending': None, 'block': None}
    page.route('**/api/status',lambda r:r.fulfill(json={'rateLimitMode':'vercel'}))
    def generate(route):
        state['calls'] += 1
        if state['block']:
            if state['block'] == 'html':
                route.fulfill(status=429,content_type='text/html',body='<h1>Too many requests</h1>')
            else:
                route.fulfill(status=429,json={'error':{'code':'RATE_LIMITED','message':'Try again later.','consumed':False}})
            return
        data = route.request.post_data_json
        payload = {'title':'Somewhere between rain and remembering','description':'Soft edges and familiar voices for the long way home.','songs':[{'title':f'A song for the evening {i+1}','artist':f'Artist {i+1}'} for i in range(data['count'])]}
        if state['calls'] == 1:
            state['pending'] = (route, payload)
        else:
            route.fulfill(json=payload)
    page.route('**/api/generate',generate)
    page.route('**/api/artwork?*',lambda r:r.fulfill(json={'artwork':None}))
    spotify_calls = []
    def spotify(route):
        title = parse_qs(urlsplit(route.request.url).query)['title'][0]
        spotify_calls.append(title)
        if title.endswith('3'):
            route.fulfill(json={'track':None})
        elif title.endswith('4'):
            route.fulfill(status=503,json={'error':{'code':'SPOTIFY_NOT_CONFIGURED','message':'Spotify preview is unavailable right now. You can still open the song on Spotify.'}})
        else:
            track_id = 'ABCDEFGHIJKLMNOPQRSTUV' if title.endswith('2') else '0123456789ABCDEFGHIJKL'
            route.fulfill(json={'track':{'id':track_id,'title':title,'artists':['Artist']}})
    page.route('**/api/spotify?*',spotify)
    page.route('https://open.spotify.com/embed/**',lambda r:r.fulfill(content_type='text/html',body='<html><body style="background:#191b1e;color:#a0a4ab;font:14px sans-serif">Spotify player — controlled browser test</body></html>'))

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
    assert page.locator('iframe').count() == 0
    assert not spotify_calls, 'No Spotify lookups before a preview click'
    page.locator('.preview-trigger').nth(0).click()
    page.locator('iframe').wait_for()
    assert '0123456789ABCDEFGHIJKL' in page.locator('iframe').get_attribute('src')
    assert len(spotify_calls) == 1
    page.get_by_role('button',name='Close Spotify preview').click()
    assert page.locator('iframe').count() == 0
    assert page.evaluate('document.activeElement.id') == 'preview-trigger-0'
    page.locator('.preview-trigger').nth(0).click()
    page.locator('iframe').wait_for()
    assert len(spotify_calls) == 1, 'Successful match cached in browser memory'
    page.locator('.preview-trigger').nth(1).click()
    page.wait_for_function("document.querySelector('iframe')?.src.includes('ABCDEFGHIJKLMNOPQRSTUV')")
    assert page.locator('iframe').count() == 1, 'Only one player can be open'
    page.locator('.preview-trigger').nth(2).click()
    page.get_by_text('No exact Spotify match found.',exact=False).wait_for()
    assert page.locator('iframe').count() == 0
    page.locator('.preview-trigger').nth(3).click()
    page.get_by_text('Spotify preview is unavailable right now.',exact=False).wait_for()
    assert page.locator('iframe').count() == 0
    assert state['calls'] == 1, 'Preview does not generate a playlist or spend generation quota'
    page.locator('.preview-trigger').nth(0).click()
    page.locator('iframe').wait_for()

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
    assert page.locator('iframe').count() == 0, 'Regeneration closes the old player'
    assert state['calls']==2
    for kind in ['json','html']:
        state['block'] = kind
        before = state['calls']
        with page.expect_response('**/api/generate'):
            page.get_by_role('button',name='Regenerate',exact=True).click()
        page.locator('.message[role=alert]').wait_for()
        assert 'request limit' in page.locator('.message[role=alert]').inner_text()
        assert page.locator('.song-list li').count() == 20
        assert page.get_by_role('button',name='Copy',exact=True).is_enabled()
        page.wait_for_timeout(150)
        assert state['calls'] == before + 1, 'No automatic retry after rate limit'
    assert 'remaining' not in page.locator('.usage').inner_text()
    state['block'] = None
    with page.expect_response('**/api/generate'):
        page.get_by_role('button',name='Regenerate',exact=True).click()
    page.wait_for_function("document.querySelector('.song-list')!==null")
    assert not errors, errors
    browser.close()
    print('PASS: missing config, validation, prompts, skeleton, exact counts, Spotify links, copy, TXT/CSV downloads, regeneration, native JSON/HTML rate-limit errors, Spotify previews/matching/cache/fallback/one-player behavior, responsive widths; no browser errors.')
