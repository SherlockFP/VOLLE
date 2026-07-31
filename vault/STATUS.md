# STATUS — 2026-07-31

> Son güncelleyen: Claude Fable 5 oturumu. Detay: [[sessions/2026-07-31-fable]]

## Bitti (commit `1741825`, pushlu)
- Ball stall fix: `isHost && !connected` iken hiçbir sim loop çalışmıyordu (RAF guard + `hostGame()` isHost reset). `tests/solo-sim-loop.test.mjs`
- Host/late-join 4 kök neden: maç başında lobi unregister, LOBBY_TTL 45s→90s (Chrome 60s clamp), lobbyWrite limit 30→120/dk, `peer-unavailable` listener yok → Join sonsuza asılıyordu
- QUICK PLAY → multiplayer hub reroute; `btn-play-online` silindi (testler pinli)
- AI skybox'lar revert (kullanıcı kararı: procedural dome daha iyi)

## Bitti (working tree, HENÜZ COMMIT YOK)
- Post-match ödül akışı (Opus agent): XP count-up + kaynak satırları, coin breakdown + first-of-day satırı, battlepass tick + next-reward ikonu, daily challenge delta kartı, PLAY AGAIN dominant. `tests/post-match-rewards.test.mjs` (9 test). MP client'ta xpSources yok — host broadcast edince eklenecek.
- Ana menü retention strip (Sonnet agent): `#menu-retention-strip` = daily kartı + battlepass kartı + mevcut streak badge; hover/press micro-interactions. `tests/menu-flow.test.mjs` +2

## Bitti (working tree, henüz commit yok — devam)
- FTUE (Sonnet): `#ftue-welcome` overlay + `#btn-how-to-play` + ilk solo maç HUD ipuçları (`ui.showMessage` üzerinden, `_doHostGame`'e bilerek bağlanmadı). Gerçek tuşlar player.js'den doğrulandı. store.js: `ftueSeen`/`ftueMatchHintsSeen`. 1237/1237.

## Bitti (working tree, henüz commit yok — devam 2)
- Wave C1 (Opus): 4 yeni map — aquarium/museum/casino/subway (arena.js +880 satır, `tests/new-arenas.test.mjs` 11 test, picker 25→29 otomatik). Browser'da bakılacaklar: cam tünel ribs, oculus ışık konisi, marquee bloom (0.78 üstü emissive), metro asma kat zıplaması.

## Devam ediyor
- (BİTTİ) Wave D1 (Opus): ball skinleri `shuriken/baseball/blockball/dark_eater` (shape sistemi, fizik tek sabit), bıçaklar `tanto/cleaver/dagger` modelleri + `dark_eater/cleaver/stiletto` case dropları, Dark Eater seti (5 parça + skin preset), Roblox mitt el + `MODEL_FRAME_OFFSET` tablosu (clipping ölçülüp fixlendi). `tests/viewmodel-cosmetics.test.mjs` 9/9. NOT: shop'ta yeni top şekilleri için 3D önizleme yok — Wave E'de main.js'e eklenecek.
- Wave C2 (Opus): estate/skyline/harbor silinip tek dev flagship hub. social-lobby/social/main.js(hub kısmı) sahipliğinde.

## Sırada (henüz başlamadı)
- Wave C2: 3 social hub map'ini (estate/skyline/harbor, js/social-lobby.js `SOCIAL_HUB_MAPS`) silip sıfırdan TEK büyük flagship hub. main.js'e dokunacak — FTUE agent bitince dispatch edilecek. Kullanıcı istegi 2026-07-31.
- Wave E (FTUE + C2 sonrası, index.html/main.js/ui.js/css boşalınca): shop bıçak menüsü geliştirme, inventory'yi CS menüsü gibi yapma, HUD arka planı canlandırma (statik/sıkıcı), ayarlar+diğer menüler mobil oyun menüsü gibi okunaklı/interaktif, ana menü aynı şekilde, patch notes içeriğini bu oturumun değişiklikleriyle güncelleme (index.html:1190 patchnotes-screen).
- graphify --update: kod oturması bekleniyor, oturum sonunda tüm dalgalar landikten sonra koş (graph.json kökte mevcut, son build 2026-07-28).

## Açık / sonraki oturum
- FTUE bitince: full suite + browser smoke + commit/push (haiku ile commit istendi)
- MP client post-match XP kaynak satırları (host `xpSources` broadcast etmeli)
- Countdown sırasında warmup topu hedefsiz süzülüyor, botlar donuk — tasarım gereği ama stall bug'ına benziyor, kullanıcı yine şikayet ederse burası
- `initPeer()` timeout yok — broker açılmazsa host akışı sessiz asılır (kanıt yok diye dokunulmadı)
- Alt-tab'da non-host solo maç donuyor (RAF durur, bg loop `!connected`'da çıkar) — yapısal boşluk
- Battlepass tier-up kutlaması yok (istenirse)

## Doğrulama durumu
- `npm test` 1233/1233 (wave A sonrası). FTUE sonrası tekrar koşulacak.
- Ortam notu: sandbox browser pane `prefers-reduced-motion: reduce` zorluyor + gizli sekmede RAF ölü → canlı smoke için manuel `game.update()` pump tekniği (bkz. session log)
