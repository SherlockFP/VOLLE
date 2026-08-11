import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const accountSource = read('js/account.js');
const storeSource = read('js/store.js');
const friendsSource = read('js/friends.js');
const mainSource = read('js/main.js');
const html = read('index.html');

test('mandatory account client retains a session token and public account only', () => {
    assert.match(accountSource, /sessionToken/);
    assert.match(accountSource, /\/api\/account\/me/);
    assert.match(accountSource, /\/api\/account\/logout/);
    assert.doesNotMatch(accountSource, /profileToken|dodgball_profile_token/);
    assert.match(storeSource, /Authorization: `Bearer \$\{sessionToken\}`/);
    assert.doesNotMatch(storeSource, /PROFILE_TOKEN_KEY|profileToken/);
});

test('boot stays behind the auth gate and guest entry points are absent', () => {
    assert.match(mainSource, /_beginAuthenticatedBoot\(\)/);
    assert.match(mainSource, /_showAuthGate\('Checking your saved session/);
    assert.match(mainSource, /await this\.store\.connectRemote\(profileName\)/);
    assert.doesNotMatch(html, /Continue as Guest|auth-skip|auth-register-avatar/);
});

test('social facade uses authenticated server endpoints and safe message DOM nodes', () => {
    assert.match(friendsSource, /\/api\/social\/me/);
    assert.match(friendsSource, /\/api\/social\/conversations\//);
    assert.match(friendsSource, /\/api\/social\/lobby-invites/);
    assert.match(mainSource, /body\.textContent = String\(message\.body \|\| ''\)/);
    assert.match(mainSource, /Friends\.createLobbyInvite\(this\._lobbyCode, friend\.id\)/);
    assert.match(mainSource, /request\.status === 'pending'/);
    assert.match(mainSource, /invite\.status === 'pending'/);
    assert.doesNotMatch(mainSource, /this\.ui\?\.currentScreen/);
    assert.doesNotMatch(mainSource, /Friends\.getDMs|Friends\.addDM/);
});

test('social polling pauses outside menu and lobby surfaces', () => {
    assert.match(mainSource, /socialScreens = new Set\(\['mainMenu', 'multiplayerMenu', 'joinMenu', 'lobby', 'socialCenter'\]\)/);
    assert.match(mainSource, /!socialScreens\.has\(document\.body\.dataset\.screen\)/);
    assert.match(mainSource, /if \(!this\._socialVisibilityBound\)/);
});

test('lobby and social hub writes receive a bearer header without token URLs', () => {
    assert.match(mainSource, /headers\.Authorization = `Bearer \$\{account\.getToken\(\)\}`/);
    assert.match(mainSource, /method: 'DELETE',\s*keepalive: true/);
    assert.doesNotMatch(mainSource, /[?&](?:token|sessionToken)=/);
});
