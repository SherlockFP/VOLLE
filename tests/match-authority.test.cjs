const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProfileStore } = require('../server/profile-store');
const { MatchAuthority } = require('../server/match-authority');
const id = suffix => `match_authority_${suffix}_0123456789`;
function fixture() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-authority-')); let now = 1000000; const profiles = new ProfileStore(path.join(dir, 'p.json')); const a = profiles.session('', 'A'); const b = profiles.session('', 'B'); const c = profiles.session('', 'C'); const lobbies = new Map([['casual', { ranked: false, memberProfileIds: new Set([a.profile.id, b.profile.id]) }], ['ranked', { ranked: true, memberProfileIds: new Set([a.profile.id, b.profile.id]) }]]); const authority = new MatchAuthority(profiles, { getLobby: code => lobbies.get(code), now: () => now, minDurationMs: 100 }); return { dir, profiles, authority, a: profiles.authenticate(a.token), b: profiles.authenticate(b.token), c: profiles.authenticate(c.token), advance: n => { now += n; } }; }
test('arbitrary P2P id cannot farm without admitted lobby membership', t => { const f = fixture(); t.after(() => fs.rmSync(f.dir, { recursive:true, force:true })); assert.equal(f.authority.start(f.a, { matchId:id('fake'), mode:'casual', lobbyCode:'missing' }).httpStatus, 403); });
test('admitted casual peers require all starts and coherent all reports', t => { const f = fixture(); t.after(() => fs.rmSync(f.dir, { recursive:true, force:true })); const matchId=id('casual'); assert.equal(f.authority.start(f.a,{matchId,mode:'casual',lobbyCode:'casual'}).httpStatus,200); assert.equal(f.authority.complete(f.a,{matchId,mode:'casual',lobbyCode:'casual',result:'win'}).httpStatus,409); f.authority.start(f.b,{matchId,mode:'casual',lobbyCode:'casual'}); f.advance(100); assert.equal(f.authority.complete(f.a,{matchId,mode:'casual',lobbyCode:'casual',result:'win'}).httpStatus,202); assert.equal(f.authority.complete(f.b,{matchId,mode:'casual',lobbyCode:'casual',result:'loss'}).httpStatus,200); assert.equal(f.authority.status(f.a,matchId).status,'finalized'); });
test('ranked rejects unranked lobby and requires two admitted profiles', t => { const f=fixture(); t.after(()=>fs.rmSync(f.dir,{recursive:true,force:true})); assert.equal(f.authority.start(f.a,{matchId:id('wrong'),mode:'ranked',lobbyCode:'casual'}).httpStatus,403); assert.equal(f.authority.start(f.a,{matchId:id('ranked'),mode:'ranked',lobbyCode:'ranked'}).httpStatus,200); assert.equal(f.authority.start(f.c,{matchId:id('ranked'),mode:'ranked',lobbyCode:'ranked'}).httpStatus,403); });
test('ranked freezes the actual two starters despite a stale third admitted member', t => { const f=fixture(); t.after(()=>fs.rmSync(f.dir,{recursive:true,force:true})); const lobby={ranked:true,players:2,maxPlayers:8,memberProfileIds:new Set([f.a.id,f.b.id,f.c.id])}; f.authority.getLobby=code=>code==='stale'?lobby:null; const matchId=id('ranked-stale'); assert.equal(f.authority.start(f.a,{matchId,mode:'ranked',lobbyCode:'stale'}).httpStatus,200); assert.equal(f.authority.start(f.b,{matchId,mode:'ranked',lobbyCode:'stale'}).httpStatus,200); assert.equal(f.authority.start(f.c,{matchId,mode:'ranked',lobbyCode:'stale'}).httpStatus,409); f.advance(100); assert.equal(f.authority.complete(f.a,{matchId,mode:'ranked',result:'win'}).httpStatus,202); assert.equal(f.authority.complete(f.b,{matchId,mode:'ranked',result:'loss'}).httpStatus,200); });
test('solo rewards are base-loss only, capped at three per UTC day, and restart replays do not consume cap', t => {
    const f=fixture(); t.after(()=>fs.rmSync(f.dir,{recursive:true,force:true})); const replayId=id('solo-replay');
    f.authority.start(f.a,{matchId:replayId,mode:'solo'}); f.advance(100);
    assert.equal(f.authority.complete(f.a,{matchId:replayId,mode:'solo'}).completion.coins,40);
    const restarted=new MatchAuthority(f.profiles,{now:()=>1100000,minDurationMs:0});
    assert.equal(restarted.start(f.a,{matchId:replayId,mode:'solo'}).httpStatus,200);
    assert.equal(restarted.complete(f.a,{matchId:replayId,mode:'solo'}).replayed,true);
    for(let n=0;n<2;n++){ const matchId=id(`solo${n}`); f.authority.start(f.a,{matchId,mode:'solo'}); f.advance(100); assert.equal(f.authority.complete(f.a,{matchId,mode:'solo'}).httpStatus,200); }
    assert.equal(f.authority.start(f.a,{matchId:id('solo4'),mode:'solo'}).httpStatus,429);
});
test('late admitted third member cannot alter a frozen two-player match', t => { const f=fixture(); t.after(()=>fs.rmSync(f.dir,{recursive:true,force:true})); const lobby={ranked:false,players:2,memberProfileIds:new Set([f.a.id,f.b.id,f.c.id])}; const authority=f.authority; authority.getLobby=code=>code==='crowded'?lobby:null; const matchId=id('frozen'); authority.start(f.a,{matchId,mode:'casual',lobbyCode:'crowded'}); authority.start(f.b,{matchId,mode:'casual',lobbyCode:'crowded'}); assert.equal(authority.start(f.c,{matchId,mode:'casual',lobbyCode:'crowded'}).httpStatus,409); f.advance(100); assert.equal(authority.complete(f.a,{matchId,mode:'casual',lobbyCode:'missing',result:'win'}).httpStatus,202); assert.equal(authority.complete(f.b,{matchId,mode:'casual',lobbyCode:'missing',result:'loss'}).httpStatus,200); });
test('ranked pair guard rejects a fourth same-day pair when the second starter freezes it', t => { const f=fixture(); t.after(()=>fs.rmSync(f.dir,{recursive:true,force:true})); for(let n=0;n<3;n++){ const matchId=id(`pair${n}`); f.authority.start(f.a,{matchId,mode:'ranked',lobbyCode:'ranked'}); f.authority.start(f.b,{matchId,mode:'ranked',lobbyCode:'ranked'}); f.advance(100); f.authority.complete(f.a,{matchId,mode:'ranked',lobbyCode:'ranked',result:'win'}); assert.equal(f.authority.complete(f.b,{matchId,mode:'ranked',lobbyCode:'ranked',result:'loss'}).httpStatus,200); } const fourth=id('pair4'); assert.equal(f.authority.start(f.a,{matchId:fourth,mode:'ranked',lobbyCode:'ranked'}).httpStatus,200); assert.equal(f.authority.start(f.b,{matchId:fourth,mode:'ranked',lobbyCode:'ranked'}).httpStatus,429); });

test('isProfileActive reflects start, finish and ttl cleanup', t => {
    const f = fixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
    const matchId = id('active-check');
    assert.equal(f.authority.isProfileActive(f.a.id), false);
    f.authority.start(f.a, { matchId, mode: 'solo' });
    assert.equal(f.authority.isProfileActive(f.a.id), true);
    f.advance(100);
    f.authority.complete(f.a, { matchId, mode: 'solo' });
    assert.equal(f.authority.isProfileActive(f.a.id), false);
});

test('ttl cleanup releases a participant even when a multiplayer match never became ready', t => {
    const f = fixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
    const abandoned = id('abandoned');
    assert.equal(f.authority.start(f.a, { matchId: abandoned, mode: 'casual', lobbyCode: 'casual' }).httpStatus, 200);
    f.advance(7200001);
    assert.equal(f.authority.isProfileActive(f.a.id), false);
    assert.equal(f.authority.start(f.a, { matchId: id('after-expiry'), mode: 'casual', lobbyCode: 'casual' }).httpStatus, 200);
});
