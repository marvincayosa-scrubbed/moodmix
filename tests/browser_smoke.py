"""Optional UI checks: pip install playwright; CHROMIUM_PATH=/usr/bin/chromium python tests/browser_smoke.py.
Uses mocked API responses; does not spend real Gemini quota.
Start `npm run build && npm start` first. Screenshots are written under /tmp.
"""
import os
import io
import wave
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
    preview_calls = []
    def preview(route):
        title = parse_qs(urlsplit(route.request.url).query)['title'][0]
        preview_calls.append(title)
        if title.endswith('3'):
            route.fulfill(json={'preview':None})
        elif title.endswith('4'):
            route.fulfill(status=503,json={'error':{'code':'PREVIEW_UNAVAILABLE','message':'Audio previews are temporarily unavailable. You can still open this song on Spotify.'}})
        else:
            clip = '2' if title.endswith('2') else '1'
            route.fulfill(json={'preview':{'url':f'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/test-{clip}.m4a','storeUrl':'https://music.apple.com/us/album/test/123?i=456'}})
    page.route('**/api/preview?*',preview)
    wav_data = io.BytesIO()
    with wave.open(wav_data, 'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(8000)
        wav.writeframes(b'\x00\x00' * 24000)
    page.route('https://audio-ssl.itunes.apple.com/**',lambda r:r.fulfill(content_type='audio/wav',body=wav_data.getvalue()))
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
    assert page.locator('audio').count() == 0
    assert not preview_calls, 'No preview lookup before a click'
    page.locator('.preview-trigger').nth(0).click()
    page.locator('audio').wait_for()
    assert 'test-1.m4a' in page.locator('audio').get_attribute('src')
    assert page.locator('audio').get_attribute('autoplay') is None
    assert len(preview_calls) == 1
    page.locator('audio').evaluate('(a) => a.play()')
    page.wait_for_function("document.querySelector('audio').currentTime > 0")
    page.evaluate('window.oldPreview = document.querySelector("audio")')
    page.get_by_role('button',name='Close audio preview').click()
    assert page.locator('audio').count() == 0
    assert page.evaluate('window.oldPreview.paused && !window.oldPreview.getAttribute("src")')
    assert page.evaluate('document.activeElement.id') == 'preview-trigger-0'
    page.locator('.preview-trigger').nth(0).click()
    page.locator('audio').wait_for()
    assert len(preview_calls) == 1, 'Successful match cached in browser memory'
    page.locator('audio').evaluate('(a) => a.play()')
    page.evaluate('window.oldPreview = document.querySelector("audio")')
    page.locator('.preview-trigger').nth(1).click()
    page.wait_for_function("document.querySelector('audio')?.src.includes('test-2.m4a')")
    assert page.locator('audio').count() == 1, 'Only one audio player can be open'
    assert page.evaluate('window.oldPreview.paused && !window.oldPreview.getAttribute("src")')
    page.locator('audio').dispatch_event('error')
    page.get_by_text('This audio preview could not play.',exact=False).wait_for()
    assert page.locator('audio').count() == 0
    page.locator('.preview-trigger').nth(2).click()
    page.get_by_text('No audio preview is available for this song.',exact=False).wait_for()
    assert page.locator('audio').count() == 0
    page.locator('.preview-trigger').nth(3).click()
    page.get_by_text('Audio previews are temporarily unavailable.',exact=False).wait_for()
    assert page.locator('audio').count() == 0
    assert state['calls'] == 1, 'Preview does not generate a playlist or spend generation quota'
    page.locator('.preview-trigger').nth(0).click()
    page.locator('audio').wait_for()
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
    assert page.locator('audio').count() == 0, 'Regeneration closes the old player'
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
    print('PASS: missing config, validation, prompts, skeleton, exact counts, Spotify links, copy, TXT/CSV downloads, regeneration, native JSON/HTML rate-limit errors, iTunes previews/playback/cache/errors/pause-on-close/one-player behavior, responsive widths; no browser errors.')
