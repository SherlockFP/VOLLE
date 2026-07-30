# V4 Master Plan — "Cheap clone → Full 3D immersive"

> Olusturuldu: 2026-07-30 (Fable orkestrasyon oturumu). Baseline: 893/893 test, 86 dosya syntax OK, git temiz @ 5ba194e.
> Bu dosya oturum kesilirse resume referansidir + sonraki oturumlarin yol haritasidir.

## Bu oturumda yurutulen (6 paralel slice)

| Slice | Kapsam | Sahip dosyalar |
|---|---|---|
| CombatFeel | Hitreg audit (tunneling, dedup penceresi, lethal grace), hitmarker + yonlu hasar gostergesi, kill-confirm "hot ball" mikro odul, hit-stop/FOV kick tune | game.js combat bolgeleri, player.js, juice.js, audio.js, perfect-deflect.js |
| SettingsUI | Tema onizleme swatchlari, ayar gruplari + aciklamalar, saved-pulse, tab basina reset, a11y | settings-controller.js, index.html settings, css |
| ShopUI | Kart netligi: fiyat/OWNED/EQUIPPED/affordability/rarity, filtre cipleri, Buy/Equip durum butonlari, #shop-earn-slot kontrati | ui.js shop bolumu, index.html shop, css |
| Economy | Mac odulu win +120 / lose +40 + perf bonus (cap 60), `POST /api/profile/ad-reward` (gunluk 5, 90sn cooldown, idempotent), Watch&Earn overlay (20sn house promo), mac-sonu ilerleme paneli (battlepass xpForTier) | server.js profile, profile-store.js, store.js, ui.js results, main.js mac-bitis |
| LobbyP2P | docs/P2P_HOST_FIXES.md 3 bug: lobby TTL/lastSeen prune, host migration uctan uca (mevcut vote/epoch infra baglama + yeni host re-register), tam state snapshot (mod/harita/mutator/skor/round), lobi tarayici UX | network.js, main.js lobi, server.js lobby API, game.js sync |
| Immersion | js/arena-decor.js (GLTFLoader, bbox normalize, dispose), MAPS.decor alani (≥3 harita), stadyum isik/emissive polish, trophy template | arena.js, renderer.js, arena-decor.js (yeni) |

## Asset durumu

- **Sketchfab API: CALISIYOR** (basic hesap). Indirilenler → `assets/cc-by/sketchfab/`:
  bleachers-small, arena-seats, scoreboard, stadium-light, gym-assets, trophy-gold (hepsi GLB, toplam ~3.8MB, CC-BY — ATTRIBUTION.md yazildi, krediler zorunlu).
- **Tripo AI: KEY GECERLI, BAKIYE 0** (403 code 2010). Text-to-3D uretim kredi alinana kadar KAPALI.
  Kredi gelirse ilk uretim listesi: ozel top skinleri (void/flame/glitch/frost ailelerine 3D varyant),
  kupa/odul heykelleri, karakter aksesuar seti (eldiven, bileklik), harita temali proplar.

## Sonraki oturumlar — oncelikli backlog

1. **Prod P2P**: production signaling + TURN config (MIMO "Public launch still needs..."), multi-peer soak test.
2. **Tema yayilimi** (V3_UX_ROADMAP 2.1): ~200 sabit turkuaz hex → `color-mix(var(--ui-primary))`, ekran ekran. Sonra light theme (2.2).
3. **Battlepass ↔ daily XP koprusu** (V3_UX_ROADMAP 3.6) + combo-tabanli ability sarji (3.3).
4. **Case reveal rarity farklilastirma** (3.4 — legendary'de juice.js slow-mo).
5. **`.gitattributes` + CRLF normalizasyonu** (4.1 — SADECE paralel agent yokken).
6. **Three.js CDN → vendor kopyasi** (4.4, surum kilidi).
7. **Tripo kredisiyle model uretimi** (yukaridaki liste) + Sketchfab'dan seyirci/kalabalik karakterleri (bu oturumda uygun CC0/CC-BY kalabalik modeli bulunamadi; kenney blocky-characters tribunlere oturtulabilir).
8. **Gercek reklam aglari**: house-promo altyapisi hazir; gercek SDK entegrasyonu (ör. web AdSense H5) ayri karar — bagimlilik kurali geregi bilincli disarida birakildi.

## Degistirilemez kurallar (ozet)
Yeni bagimlilik yok · ball.js steering olcumsuz degismez · takim renkleri tema-bagimsiz ·
case-opener/showcase/account sistemi yeniden yazilmaz · full suite sadece orkestrasyon sonunda.
