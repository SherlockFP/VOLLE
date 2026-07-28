# V3 UI / Görsel Yol Haritası

> Oluşturuldu: 2026-07-28. Kapsam: web istemcisi (Roblox portu `src/` kapsam dışı).
> Kaynak: repodaki `docs/NEXT_SESSION_PLAN.md` §4.5 + bu oturumda yapılan kod denetimi.
> Her madde gerçek dosya/satır referansı taşır; tahmini efor "bir agent oturumu" birimindedir.

---

## 0. Kök neden analizi — ana sayfa neden "sıradan" hissettiriyordu

Denetlendi, üç somut neden bulundu:

1. **Tema motoru menüye hiç ulaşmıyordu.** `#main-menu` kendi paletini sabit hex
   değerlerle tanımlıyordu (`css/polish.css:1146-1161`), `--ui-*` tema tokenlarından
   türemiyordu. Tema değiştirmek menüde neredeyse hiçbir şeyi değiştirmiyordu.
2. **Sadece 2 tema vardı ve ikisi de aynı aileden.** `dark` ve `soft-spectrum`
   (`js/ui-theme.js`) — her ikisi de koyu turkuaz. Görsel çeşitlilik pratikte sıfır.
3. **Hero karakteri CSS kutusuydu.** `.ow-character-head/body/arm/ball` düz div +
   gradient (`index.html`, `css/polish.css:1363-1385`). Oysa repoda çalışan bir
   Three.js karakter rig'i (`js/shop-showcase.js` → `ShopShowcaseRenderer`) vardı ve
   sadece Shop ekranında kullanılıyordu.

Ayrıca menü etkileşim renkleri (`hover`/`focus`) sabit `rgba(94, 231, 247, …)`
turkuazdı — tema değişse bile hover turkuaz kalıyordu.

---

## 1. Bu oturumda tamamlanan (kanıtlı)

| İş | Dosyalar | Kanıt |
|---|---|---|
| Menü paleti tema tokenlarına bağlandı | `css/ui-tokens.css`, `css/polish.css` | `dark` fallback'leri eski değerlerle birebir → regresyon yok |
| 4 yeni tema: Ember, Violet Surge, Verdant, Crimson Court | `css/ui-tokens.css`, `js/ui-theme.js`, `index.html` | Tarayıcıda `#setting-theme` üzerinden 4 tema ayrı ayrı doğrulandı |
| Ana menüde canlı 3D hero (mevcut rig yeniden kullanıldı, ikinci renderer yok) | `index.html`, `js/main.js`, `js/shop-showcase.js`, `css/polish.css` | WebGL buffer 755×857, CSS fallback otomatik kapanıyor |
| Kamera çerçevesi opsiyonel hale getirildi (Shop davranışı değişmedi) | `js/shop-showcase.js` | `options.camera` yoksa eski değerler |
| Hover/focus renkleri temaya bağlandı | `css/polish.css` | `color-mix(in srgb, var(--menu-cyan) …)` |
| Reduced-motion: uygulama ayarı + OS tercihi OR'lanıyor | `js/shop-showcase.js`, `js/main.js` | `applyAccessibility` zinciri uçtan uca doğrulandı |
| Tema kataloğu sözleşme testi (3 dosya arası drift'i yakalar) | `tests/ui-theme-catalog.test.mjs` | 5 test |

Doğrulama: `npm run check` → 79 dosya temiz. `node --test` → **509/509 geçti**.

**Bilinen ortam kısıtı:** bu sandbox'ta `document.hidden === true` olduğu için
`requestAnimationFrame` donuk; 3D hero'nun *statik* render'ı doğrulandı, idle
rotasyonu piksel karşılaştırmasıyla doğrulanamadı (repo bu kısıtı
`docs/NEXT_SESSION_PLAN.md` satır 128'de zaten not etmiş).

---

## 2. Faz 1 — Menüyü "canlı ürün" hissine taşımak (en yüksek etki/efor oranı)

| # | İş | Dosya | Efor |
|---|---|---|---|
| 1.1 | Hero'ya tema-farkında zemin/ring rengi: `ShopShowcaseRenderer._buildEnvironment` sabit `0x12384d`/`0x5af7ef` kullanıyor; tema accent'ini CSS'ten okuyup materyale geçir | `js/shop-showcase.js` | 0.3 |
| 1.2 | Hero'da ekipmanlı bıçak/kozmetik göster (oyuncunun sahip olduğu şeyi menüde görmesi güçlü bir "geri dön" kancası) | `js/main.js`, `js/cosmetic-models.js` | 0.5 |
| 1.3 | Hero'ya "idle → victory" tek seferlik poz tetikleyicisi (maçtan kazanarak dönüldüğünde) | `js/main.js`, `js/character-anim.js` | 0.5 |
| 1.4 | Motion token birleştirme: `css/style.css`/`polish.css` içindeki ad-hoc `transition: … 200ms ease` kuralları `--ui-motion-*` + `--ui-ease`'e taşınsın (bu oturumda `.ow-sbtn` ve `.ow-tab` yapıldı, kalan ~50 kural) | `css/style.css`, `css/polish.css` | 1.0 |

## 3. Faz 2 — Tema sisteminin geri kalan ekranlara yayılması

Şu an temalar `#main-menu` + `--ui-*` tüketen bileşenlerde çalışıyor. Diğer ekranlar
(`#shop-screen`, `#lobby-screen`, career, battle pass) hâlâ büyük ölçüde sabit
turkuaz/lacivert hex kullanıyor.

| # | İş | Dosya | Efor |
|---|---|---|---|
| 2.1 | `rgba(112, 221, 255, …)` / `rgba(94, 231, 247, …)` sabitlerini `color-mix(… var(--ui-primary) …)`'e taşı (grep ile ~200 eşleşme, ekran ekran yapılmalı) | `css/style.css`, `css/polish.css` | 2.0 |
| 2.2 | **Açık (light) tema** — ancak 2.1 bittikten sonra. Şu an denenirse 328KB'lık sabit-koyu CSS yüzünden yarı bozuk görünür. Bilinçli olarak ertelendi. | — | 1.5 |
| 2.3 | Tema önizleme: ayarlar modalinde her tema için küçük renk şeridi (seçmeden önce görme) | `index.html`, `js/settings-controller.js` | 0.4 |

## 4. Faz 3 — Oyuna eklenebilecek mekanikler (repo planından, önceliklendirilmiş)

Bunlar `docs/NEXT_SESSION_PLAN.md` §1-4'ten geliyor; hâlâ açık:

| # | İş | Dosya | Neden değerli |
|---|---|---|---|
| 3.1 | **Maç sonrası ilerleme ekranı** — battle pass tier'a kalan XP, streak, sıradaki ödül aynı ekranda | `js/ui.js`, `js/battlepass.js` (`xpForTier` zaten export) | En güçlü "bir tur daha" kancası, veri zaten var |
| 3.2 | **Kill-confirm mikro ödülü** — öldürmeden sonra 3-4sn "yanan top", sonraki atışta küçük bonus | `js/game.js` (`_killStreaks` civarı) | Kısa, okunabilir, ranked kurallarını bozmuyor |
| 3.3 | **Combo tabanlı ability şarjı** — art arda perfect deflect cooldown düşürsün | `js/skills.js`, `js/perfect-deflect.js` | Mevcut beceriyi ödüllendirir, yeni sistem gerekmez |
| 3.4 | **Case açma reveal'ını rarity'ye göre farklılaştır** — legendary'de `js/juice.js` slow-mo ödünç al | `js/cosmetics.js`, `js/ui.js`, `js/juice.js` | Mevcut altyapı, sadece bağlama işi |
| 3.5 | **Goal Rush power shot** — 8m altından atılan gol 2 puan | `js/goal-mode.js` (`checkGoalEntry` top pozisyonuna zaten sahip) | Tek fonksiyon değişikliği |
| 3.6 | Battlepass ↔ günlük görev XP köprüsü (iki sistem şu an bağımsız) | `js/daily.js`, `js/battlepass.js` | Progression boşluğunu kapatır |

## 5. Faz 4 — Teknik borç (görsel işten önce yapılması gerekenler)

| # | İş | Not |
|---|---|---|
| 4.1 | **`.gitattributes` + CRLF/LF normalizasyonu** | `docs/NEXT_SESSION_PLAN.md` satır 21-25: bu yüzden 40k satırlık sahte merge çakışması çıktı. SADECE paralel agent çalışmıyorken yapılmalı. |
| 4.2 | `css/polish.css` içindeki **çoklu `#main-menu` background kuralı** (satır 1158 ve 2077 aynı şeyi tanımlıyor, ikincisi kazanıyor) tek kurala indirilmeli | Bu oturumda ikisi de temaya bağlandı ama duplikasyon duruyor; birleştirme ayrı, dikkatli bir iş |
| 4.3 | Siluet `renderer.createTargetOutline` geri getirme | `bot.js`/`game.js` çağrıyı zaten bekliyor |
| 4.4 | Three.js CDN → yerel vendor kopyası (sürüm kilidi) | `docs/WARBALL_IO_PLAN.md` §4 |

---

## 6. Dokunulmaz alanlar

- `js/ball.js` steering/homing matematiği — bu repoda 2 kez sebepsiz bozulup
  düzeltildi (`AGENTS.md` kural 7). Değişiklik gerekiyorsa ölçülen önce/sonra sayıları
  raporlanmalı.
- Takım kırmızı/mavi renkleri tema-bağımsız kalmalı — `PLAN.md` satır 98: efektler
  top veya takım sahipliğini gizleyemez. `tests/ui-theme-catalog.test.mjs` bunu kilitliyor.
- Yeni bağımlılık yok: Three.js + vanilla JS + Node built-in.
