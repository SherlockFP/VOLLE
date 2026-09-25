# 2026-09-25 — Sınırlı döngü: mobil + ilk yükleme

Önceki: [[2026-09-24-p2p-guest-join]]. Dal `claude/keen-mendel-wce2hx`.

## Birleştirme
main'e başka oturumdan gelen çevrimiçi oyun düzeltmesi (misafir lobi oturumu, WebSocket relay, TURN) bu dalla birleştirildi (`031356d`). Admission/host akışında main alındı; bu daldan yalnız hayalet paket düşürme, host takım otoritesi, `playerId` ile takım eşleşmesi, profil adı ve M menüsü kaldı.

## Sözleşme (işe başlamadan yazıldı)
- **A — mobil:** yatay telefon + dokunmatik: açılış, maç, joystick yürütür, sürükleme döndürür, DEFLECT çalışır, sayfa hatası yok. Kanıt: Playwright dokunmatik emülasyon.
- **B — performans:** ilk açılış JS (brotli) ≥ %20 azalır. Kanıt: build öncesi/sonrası ölçüm + oyun açılır.
- **Değişmezler:** tüm testler geçer, `npm run check` temiz, yeni runtime bağımlılığı yok, oynanış/host otoritesi değişmez, build'siz dev modu çalışır.
- **Sınırlar:** hedef başına ≤3 düzeltme turu, hedef başına ayrı commit, ajan filosu yok; yeni bulgular kapsamı genişletmez, listeye girer; hedef değişikliği sahibin onayıyla.

## Sonuç
**A — geçti** (`fe7c166`). iPhone SE / 13, Pixel 7, iPad Mini (yatay, dokunmatik): joystick yürütür, sürükleme kamerayı çevirir, DEFLECT basar, sayfa hatası yok, dokunmatik tuşun üstünde HUD metni yok (SE'de skor paneli köşesi emote tuşuna 7 px değiyor — kabul edildi). Düzeltilen: hoş geldin kartı WASD/tık anlatıyordu → dokunmatik metin (EN/TR) + kısa ekrana sığıyor; Practice Lab kartı sağ yarıda Deflect/Stab/Skill/R/F'nin altındaydı → skor altı şerit; ultimate halkası SE'de Jump'ın üstündeydi; hız hapı SE'de Skill altına giriyordu → kompakt/gizli. 2 tur kullanıldı.

**B — kısmi, plato** (`1582fbc`). three.js ağaç sallaması bozuktu (`map-art/kit.js` THREE'yi yeniden dışa veriyordu, `ball.js` argüman geçiyordu, `spectator.js` `import('three')`): three 688 → 550 KB; ilk JS 2407 → 2286 KB ham, **618 → 590 KiB brotli (−%4,5)**. Hedef %20'ye güvenli yoldan ulaşılamadı: kalan her kalem `main.js`'te çok sayıda statik import'u dinamiğe çevirmek (geniş kapsam/risk). Koruma testi: `tests/three-tree-shaking.test.mjs`.

**Hedef değişikliği (sahip onayladı):** gerçek tarayıcıda ilk açılış toplam 2046 KiB, JS'in payı yalnız 652 KiB (%32). Yeni hedef **B′: ilk açılış toplam bayt ≥ %20 azalsın** (≤ 1637 KiB), aynı kanıt yöntemiyle.

**B′ — geçti** (`5f5902d`). **2046 → 1034 KiB (−%49,5)**, 1 tur. Kupa GLB (443 KiB) menü arenasında değil, antrenman dışı maç başlayınca (`Game.startGame`, host ve istemci) yükleniyor; sayfadaki logolar 384 px WebP (31 KiB), favicon 64 px PNG (7 KiB) — ikisi de orijinal PNG'den Chromium canvas ile türetildi; manifest/apple-touch 512 PNG'de kaldı. Mağaza, kasa ve maç sonu görselleri `loading="lazy"`. Doğrulama: açılışta hiçbiri inmiyor; mağaza/maç sonu görselleri ekran açılınca yükleniyor; kupa şablonu maç sırasında hazır. Koruma testi: `tests/first-load-budget.test.mjs`.

## Açık / sonraki
- Kalan ilk yük: JS 653 KiB (three.js ~%40), menü arka planı 170 KiB, CSS 144 KiB (`polish.css` tek başına 63 KiB sıkıştırılmış).
- Dokunmatikte maç sonu "Space · Skip" ipucu yanlış (dokunmatik katman fare olayını engelliyor; solo tur 4 sn'de kendisi bitiyor).
- Yükleme ipuçları 4/5 (Ctrl, sağ tık) dokunmatikte de klavye anlatıyor.
- SE emülasyonunda bir kez: oyuncu orta çizgiye koşarken ekran karardı + sarı şekil (büyük ihtimalle yakın mesafe top isabeti efekti). Kasıtlı yeniden üretilmedi, düşük güven.
- Sunucu ilk istekte 2 MB'lık paketi senkron brotli (kalite 9) ile sıkıştırıyor; deploy sonrası ilk ziyaretçi bekliyor.

## Ölçüm araçları (scratchpad, repo dışı)
`measure.mjs` (esbuild metafile → ilk yükleme JS), `boot.cjs` (tarayıcıda tür başına bayt), `mobile.cjs` (dokunmatik E2E + HUD/tuş çakışma denetimi, `DEV=` cihaz), `ftue.cjs` (hoş geldin kartı sığma).
