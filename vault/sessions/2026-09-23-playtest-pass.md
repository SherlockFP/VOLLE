# 2026-09-23 — Playtest geçişi

Commit `b847617` (main). Önceki: [[2026-09-23-aaa-overhaul-pass2]].

## Yöntem
- `?debug=1` → `window.__volle`; `app.clock.getDelta = () => 1/60`, rAF stub'lı `app.loop()` adımlama, 60 karede bir `await setTimeout` (oyun zamanlayıcıları çalışsın diye).
- Tarayıcı paneli gizliyken CSS geçişleri/animasyonları donuyor → konum ölçümleri yanıltabilir (`getAnimations()` ile kontrol et).

## Bulunan ve düzeltilenler
- **Harbor Nightworks gökyüzünde dev beyaz lekeler:** gök kubbesi shader'ı bulutları sabit beyazla karıştırıyordu; `cloudAmount` 0.65 + karanlık gök = parlayan ovaller. Bulut rengi artık ufuk parlaklığından (`skyLum`) türetiliyor; harbor `cloudAmount` 0.4. Hava partiküllerine yakın-kamera solması + boyut sınırı.
- **Ana menü:** kapalı social rail 184 px'lik tam boy koyu şerit olarak öne çıkan kartın üstüne biniyordu → 48 px başlık hapı. (`css/menu-rework.css` hiç yüklenmiyor — ölü dosya.)
- **Esc:** menü alt ekranlarında (map editor, shop, profile, …) Back'e basar (`ESC_BACK_BUTTONS`); lobi hariç.
- **Lobi:** -BOT / LOCK butonları 40 px kareye sıkışıp satır kırıyordu → içeriğe göre genişlik. START GAME, READY, LOCK, Bots, Waiting, LOCAL/P2P EN/TR.
- **Maç sonu:** key art 1012 px'e uzayıp sadece karanlık gökyüzünü gösteriyordu → sticky çerçeve, mutlak `img`. Seviye chip'i, rematch alt yazısı.
- **Maç sonu harita rotasyonu** `onMapChange` çağırmıyordu → lobi carousel/başlık eski haritada kalıyordu.

## Doğrulama
- **2273/2273 test**, `npm run check` 138 dosya, build OK. Yeni: `tests/playtest-polish.test.mjs`.
- Tam bot maçı → postgame → lobiye dönüş: sayfa hatası yok.

## Kalan
- Esport Arena skorbord arkası siyah (küçük), `.ow-splash` dışındaki menü üst üste binmeleri gerçek ekranda tekrar bakılmalı.
- Açılış topu sistem mesajı (`CLAIMED THE OPENING BALL`) ağ üzerinden gittiği için çevrilmedi.
- Stripe env değişkenleri kullanıcıda (`docs/PAYMENTS.md`).
