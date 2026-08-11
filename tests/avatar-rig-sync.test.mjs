import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [game, main, network] = await Promise.all([
    readFile(new URL('../js/game.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/network.js', import.meta.url), 'utf8')
]);

test('remote and bot character ids update the canonical rig only when the id changed', () => {
    const guardedSync = /if \(data\.charId && data\.charId !== p\.charId\) \{\s*p\.charId = data\.charId;\s*p\.rig\?\.setCharacter\(data\.charId\);/;
    const botSync = /if \(bd\.charId && bd\.charId !== p\.charId\) \{\s*p\.charId = bd\.charId;\s*p\.rig\?\.setCharacter\(bd\.charId\);/;
    const rosterSync = /if \(pl\.charId && pl\.charId !== p\.charId\) \{\s*p\.charId = pl\.charId;\s*p\.rig\?\.setCharacter\(pl\.charId\);/;
    assert.match(game, guardedSync);
    assert.match(game, botSync);
    assert.match(game, rosterSync);
});

test('shop, menu, Studio and remote players use the full-body atlas API', () => {
    assert.match(main, /rig\.setAvatarAtlasTexture\(texture, modelId\)/);
    assert.doesNotMatch(main, /rig\.setHeadTexture\(texture\)/);
    assert.match(game, /this\.rig\.setAvatarAtlasTexture\(tex, this\.avatarModel\)/);
    assert.match(game, /this\.rig\.setAvatarAtlasTexture\(null\)/);
});

test('avatar model metadata is allowlisted and stays outside position packets', () => {
    assert.match(network, /const isAvatarModel = value => value === undefined \|\| value === 'classic' \|\| value === 'slim';/);
    assert.match(network, /avatarModel,/);
    assert.match(network, /isAvatarModel\(data\.avatarModel\)/);
    assert.doesNotMatch(network, /sendPosition[\s\S]{0,900}avatarModel/);
});
