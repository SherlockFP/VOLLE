# AAA Yol Haritası — Satışa Hazır Sürüm (2026-09-23)

Kaynak: 4 alan denetimi (gameplay, UX, ekonomi, teknik) + elle doğrulama + tarayıcıda
gerçek açılış. Başlangıç durumu: **1954/1954 test geçiyor**, konsolda hata yok.

## Durum — Geçiş 1 sonu (2026-09-23)

✅ Yapıldı: Faz 0 tamamı (+ kritik veri sızıntısı, service worker hatası) · Faz 1: misafir girişi, otomatik eğitim, tek marka VOLLE, yeni oyuncu kilitleri, yükleme ipuçları · Faz 2: viewmodel varsayılan açık, nadirlik efektleri, deflect geri tepmesi, "Try in hand" · Faz 3: stereo ses, kenar vignette, rally tavanı + overdrive, 4 harita layout'u · 3D-imsi menü.
⏳ Kalan: gerçek ödeme akışı, i18n (TR/EN), mobil kontroller, esbuild paketi, gerçek liderlik tablosu, ranked hile kontrolü, SQLite kayıt, top↔platform çarpışması, menü karakteri sanat geçişi, rune slotu, bot perfect deflect, maç sonu performans ödülü.
Ayrıntı: `vault/sessions/2026-09-23-aaa-overhaul-pass1.md`.

Öncelik ölçüsü: *yeni oyuncunun ilk 5 dakikası* > *skin satışı* > *uzun vadeli bağlılık* > *teknik borç*.

---

## Faz 0 — Kanayan yaralar (satıştan ÖNCE zorunlu)

| # | Sorun | Kanıt | Çözüm |
|---|---|---|---|
| 0.1 | **Misafir girişi yok** — oyun, e-posta/şifre formu açılmadan başlamıyor | `js/main.js:687` `_beginAuthenticatedBoot`, `index.html:102` | "Hemen Oyna" → misafir profil; hesap sadece ödül/satın almada istenir |
| 0.2 | **Bedava coin açığı** — menüdeki günlük giriş butonu hâlâ yerel kod | `js/main.js:3591` → `store.claimDailyLogin()` (`store.js:1394`) | Butonu sunucu tarafı `claimLoginStreak()`'e bağla, yerel yolu sil |
| 0.3 | **Sessiz yerel ekonomi** — sunucu bağlantısı koparsa satın almalar localStorage'a yazılıyor | `store.js:1167,1489,1502` | Hesaplı oyuncuda bağlantı yoksa satın alma engellenir |
| 0.4 | **Combo çarpanı yanlış oyuncuya** — yerel oyuncunun combosu botların vuruşlarını da güçlendiriyor | `game.js:3474` | `attacker === this.player ? combo : 1` |
| 0.5 | **CI testsiz yayınlıyor** | `.github/workflows/publish-image.yml` | Docker build öncesi `npm test` adımı |
| 0.6 | **Skin sahiplik anahtarı her açılışta değişiyor** | `server.js:54` `randomBytes(32)` | `COSMETIC_ENTITLEMENT_SECRET` ortam değişkeni, yoksa uyarı |
| 0.7 | Statik dosya yol kontrolü önek eşleşmesi | `server.js:1059` | `startsWith(ROOT + path.sep)` |
| 0.8 | Kasa → gerçek para yolu kodda engellenmemiş (Belçika/Hollanda yasağı) | `docs/V3_ECONOMY.md` sadece kural olarak | Sunucuda sert kural: kasalar yalnız coin ile açılır |

## Faz 1 — İlk 5 dakika (bağımlılığın başladığı yer)

- **Tek marka.** Şu an 3 isim var: `VOLLE` (başlık), `WARRBALL` (logo), `2BALL` (dokümanlar). **→ Karar gerekli.**
- **Eğitim otomatik açılsın.** FTUE ekranı hazır ama sadece küçük bir ikona bağlı (`main.js:1697`). `onboardingSeen` girişte körlemesine `true` yapılıyor (`main.js:722`).
- **Aşamalı menü.** İlk maçtan önce Ranked / Battle Pass / Turnuva / Kart "Sv. X'te açılır" kilitli gösterilir. 8 sekme → yeni oyuncuya 3.
- **Yükleme ekranı.** Statik "Loading assets..." yerine dönen ipuçları + yüzde (`index.html:77`).
- **Tek dil sistemi.** Locker'da İngilizce başlık + Türkçe açıklama karışık. `i18n` tablosu (TR/EN) + Ayarlar'da dil seçimi.
- **Mobil.** Menüler mobil uyumlu ama maçta dokunmatik kontrol yok → ya sanal joystick ya "masaüstünde oyna" ekranı.

## Faz 2 — Skin ekonomisi & viewmodel (para buradan gelir)

Mevcut temel iyi: knife animasyon sistemi (draw/slash/stab/heavy/inspect + %3.5 nadir inspect), 6 kasa, pity sayacı, nadirlik FX tablosu.

- **Nadirlik katmanlı viewmodel görünümü.** Rare+ skinlerde: kenar parıltısı (fresnel), Epic+ savuruş izi (trail), Legendary+ inspect'te partikül + özel ses, Mythic'te canlı (animasyonlu) doku.
- **Inspect sahnesi.** Mağaza/Locker'da skini 3D döndürme, yakınlaştırma, "elinde gör" (viewmodel önizleme) — satın alma kararını veren ekran bu.
- **Vuruş hissi viewmodel'de.** Deflect anında el geri tepmesi (recoil) + mikro hit-stop; perfect deflect'te skin'in nadirlik rengiyle flaş.
- **Öldürme sayacı (StatTrak benzeri)** skinler — skine bağlılık yaratır, klasik yüksek fiyat kalemi.
- **Top skinleri için iz + çarpma efekti** nadirliğe göre; rakip de görür → sosyal vitrin = satış.
- **Gerçek ödeme akışı yok.** Sunucuda webhook doğrulama var, istemcide ödeme başlatma yok (`server/payment-ledger.js`). Stripe/Paddle checkout + gem paketleri.
- **Premium Battle Pass** şu an sadece coin ile — gem ile satılmalı (en güçlü F2P geliri).
- **Kasa olasılıkları** mağazada açıkça yazılmalı (AB/Çin şartı, ayrıca güven verir).

## Faz 3 — Gameplay derinliği

- **Rally hız tavanı kararı.** Kod "bilerek sınırsız" diyor (`ball.js:605`) ama modlar `maxSpeed=6x` ayarlıyor ve hiçbir yer okumuyor (`gamemodes.js:107`). Uzun rallilerde hız → proximity force-hit otomatiğe dönüyor (`ball.js:1092`). Öneri: 6x tavan + tavanda "OVERDRIVE" görsel/ses durumu.
- **3D/stereo ses.** Top vızıltısı/vuruş sesleri yönsüz (`audio.js`). `StereoPanner` (desen `voice.js`'te hazır).
- **Harita = gerçek layout.** ~28 harita çoğunlukla aynı kutu + tema. 4 flagship haritaya siper, yükseklik, köşe.
- **Tam ekran beyaz flaş** kill'de topu gizliyor (`juice.js:187`) — kendi tasarım dokümanına aykırı. Kenar vignette'e çevir.
- **Rune slotu:** yorum "4 slot" diyor, kod 1 uyguluyor (`skills.js:82`). Ya 2 slot ya dürüst UI.
- **Bot perfect deflect yapmıyor** — Hard/Expert botlara zamanlama penceresi.
- **Performans ödülü:** kill/deflect bonus formülü gerçek maçlarda çalışmıyor (`profile-store` `score:0`).

## Faz 4 — Bağlılık döngüleri

- **Gerçek liderlik tablosu** — şu an 50 sahte isim (`js/leaderboard.js`). Sunucudaki ELO zaten var.
- **Ranked hilesi:** iki hesap anlaşıp ELO kasabiliyor (sadece 20 sn + iki tarafın beyanı) — sunucu tarafı maç özeti karşılaştırması.
- **Haftalık görevler + sezon hikâyesi**, arkadaşla oynama bonusu, ilk galibiyet x2.
- **Kayıt kötüye kullanımı:** e-posta doğrulama / hesap başına ödül limiti.

## Faz 5 — Teknik temel

- **Paketleme:** esbuild ile tek bundle + minify (100+ istek → birkaç; three.js 1.4 MB ham).
  *Not:* proje "sıfır bağımlılık" kuralına sahip — esbuild sadece build aracı olur, runtime'a girmez. **→ Karar gerekli.**
- **Müzik kopyaları:** `.mp3` ve `.sfx` birebir aynı. Oyun `.sfx` kullanıyor (IDM önlemi) → `.mp3`'ler silinebilir (~4.8 MB repo, oyuncuya etkisi yok).
- **Hata takibi:** `window.onerror` + sunucu `/api/telemetry/error` (mevcut telemetry deposu kullanılır).
- **Senkron dosya yazma** her profil değişikliğinde tüm JSON (`profile-store.js:370`) → yazma birleştirme / SQLite (node:sqlite yerleşik).
- **God-file'lar:** `main.js` 8.7k, `game.js` 6.9k satır — yeni iş ayrı modüle, eskiler dokunuldukça bölünür.

---

## Uygulama sırası (önerilen)

1. Faz 0'ın tamamı (küçük, güvenli, testli)
2. Misafir girişi + otomatik eğitim + tek marka
3. Viewmodel nadirlik katmanları + inspect sahnesi
4. Ödeme akışı (ödeme sağlayıcı hesabını **sen** açmalısın)
5. Gameplay derinliği, sonra teknik temel
