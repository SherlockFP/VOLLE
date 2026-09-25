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

**Bulgu (hedef değişikliği önerisi, onay bekliyor):** gerçek tarayıcıda ilk açılış toplam **2046 KiB**, JS'in payı yalnız 652 KiB (%32). En büyük kalemler açılışta gereksiz: `trophy-gold.glb` 443 KiB (yalnız maç sonu), `volle-logo-512.png` 297 KiB, maç sonu görseli 134 KiB, mağaza görseli 125 KiB. Doğru metrik "ilk açılış toplam bayt"; bu kalemleri ertelemek JS çalışmasından çok daha fazla kazandırır.

## Açık / sonraki
- B'nin hedefini "ilk açılış toplam bayt ≥ %20" olarak değiştirmek için sahibin onayı.
- Dokunmatikte maç sonu "Space · Skip" ipucu yanlış (dokunmatik katman fare olayını engelliyor; solo tur 4 sn'de kendisi bitiyor).
- Yükleme ipuçları 4/5 (Ctrl, sağ tık) dokunmatikte de klavye anlatıyor.
- SE emülasyonunda bir kez: oyuncu orta çizgiye koşarken ekran karardı + sarı şekil (büyük ihtimalle yakın mesafe top isabeti efekti). Kasıtlı yeniden üretilmedi, düşük güven.
- Sunucu ilk istekte 2 MB'lık paketi senkron brotli (kalite 9) ile sıkıştırıyor; deploy sonrası ilk ziyaretçi bekliyor.

## Ölçüm araçları (scratchpad, repo dışı)
`measure.mjs` (esbuild metafile → ilk yükleme JS), `boot.cjs` (tarayıcıda tür başına bayt), `mobile.cjs` (dokunmatik E2E + HUD/tuş çakışma denetimi, `DEV=` cihaz), `ftue.cjs` (hoş geldin kartı sığma).
