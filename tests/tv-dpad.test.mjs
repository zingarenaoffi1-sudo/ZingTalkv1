import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Fire TV app.js registers capture-phase D-Pad listener without duplicate card keydown listeners', () => {
    const tvApp = fs.readFileSync(path.resolve('packages/tv/app.js'), 'utf8');

    assert.match(
        tvApp,
        /window\.addEventListener\(\s*["']keydown["'][\s\S]*\{\s*capture:\s*true\s*\}\)/,
        'Global keydown handler must use { capture: true } so Android WebView cannot steal D-Pad focus'
    );
    assert.ok(
        tvApp.includes('if (e.isComposing || e.defaultPrevented) return;'),
        'Global keydown handler must ignore IME composing and already-prevented events'
    );
    assert.ok(
        !tvApp.includes('card.addEventListener("keydown"'),
        'Contact cards must rely on the single unified window Enter handler (no duplicate card keydown listener)'
    );
    assert.ok(
        tvApp.includes('isAndroidNonPrintable') && tvApp.includes('!isPrintableChar'),
        'Android raw keyCode fallbacks (82/85/66/19-23) must never trigger when typing printable keyboard characters like R, U, or B'
    );
});

test('Fire TV app.js exposes window.handleConnectorRemoteCommand and topmost modal priority stack', () => {
    const tvApp = fs.readFileSync(path.resolve('packages/tv/app.js'), 'utf8');

    assert.ok(
        tvApp.includes('window.handleConnectorRemoteCommand = (cmd) => dispatchRemoteKey(cmd);'),
        'app.js must attach handleConnectorRemoteCommand onto window for MainActivity.java WebView bridge'
    );
    assert.ok(
        tvApp.includes('const MODAL_STACK_PRIORITY = [') && tvApp.includes('function getTopActiveModal()'),
        'app.js must define explicit modal stack priority ordering'
    );
    assert.ok(
        tvApp.includes('function closeModalAndRestoreFocus(') && tvApp.includes('lastNonModalFocusedElement'),
        'app.js must restore the last non-modal focused element when closing dialogs'
    );
    assert.ok(
        tvApp.includes("behavior: dpadRapidHold ? 'auto' : 'smooth'"),
        'focusElement must switch to auto scroll behavior during rapid D-Pad holds'
    );
});

test('prepare-android.js MainActivity hardens Fire TV WebView focus and dispatches Menu / PlayPause keys cleanly', () => {
    const prepareScript = fs.readFileSync(path.resolve('scripts/prepare-android.js'), 'utf8');

    assert.ok(
        prepareScript.includes('webView.setDefaultFocusHighlightEnabled(false);'),
        'MainActivity must disable Android default blue WebView focus ring in favor of ZingTalk cyan TV ring'
    );
    assert.ok(
        prepareScript.includes('public boolean dispatchKeyEvent(android.view.KeyEvent event)'),
        'MainActivity must intercept Menu and MediaPlayPause via dispatchKeyEvent'
    );
    assert.ok(
        prepareScript.includes('KeyEvent.KEYCODE_MENU') && prepareScript.includes('KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE'),
        'MainActivity dispatchKeyEvent must support Menu and MediaPlayPause'
    );
    assert.ok(
        fs.existsSync(path.resolve('android/app/src/main/java/com/zingtalktv/com/MainActivity.java')),
        'Prepared TV MainActivity.java must exist'
    );
    const tvMainActivity = fs.readFileSync(path.resolve('android/app/src/main/java/com/zingtalktv/com/MainActivity.java'), 'utf8');
    assert.ok(
        tvMainActivity.includes('dispatchKeyEvent(android.view.KeyEvent event)'),
        'Generated android MainActivity.java must include dispatchKeyEvent override'
    );
});
