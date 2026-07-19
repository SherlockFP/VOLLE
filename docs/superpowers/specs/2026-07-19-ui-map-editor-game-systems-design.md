# 2BALL UI, Creator ve Oyun Sistemleri Yenileme Tasarimi

Tarih: 2026-07-19
Durum: Kullanici tarafindan onaylandi

## 1. Hedef

2BALL'in mevcut Three.js ve vanilla JS mimarisini koruyarak menuleri modernlestirmek, kritik UI hatalarini gidermek, guvenli paylasilabilir crosshair ve harita kodlari eklemek, map editoru 3D sandbox aracina donusturmek, shop/class sunumunu gelistirmek, Social Hub'i zenginlestirmek, P2P akiciligini olculebilir bicimde iyilestirmek.

Tam UI rewrite yapilmayacak. Calisan oyun, arena, store, network, screen routing ve renderer sistemleri yeniden kullanilacak. Yeni sistemler moduler olacak; eski cakisan UI kurallari kontrollu bicimde devreden cikarilacak.

## 2. Basari Kriterleri

- Menu, settings, lobby, social, shop, scoreboard ekranlari 1280x720, 1366x768, 1920x1080 ve ultrawide gorunumlerde tasma veya kirpilma olmadan kullanilabilir.
- Dark ve soft-spectrum temalari aninda degisir, kalici kaydedilir, metin kontrasti en az 4.5:1 olur.
- Settings tek kaynakli olur; acik tab ortalanir; keyboard ve mouse ile kullanilir.
- Scoreboard viewport merkezinde acilir, Tab basili tutuldugunda gorunur, oyuncu adlari guvenli DOM ile yazilir.
- Crosshair preview ile oyun reticle'i ayni renderer ve ayni ayar modelini kullanir.
- Crosshair ve map kodlari version, boyut, whitelist ve checksum dogrulamasindan gecmeden uygulanmaz.
- 3D editor base map, prop ekleme, secme, tasima, dondurme, olcekleme, grid snap, undo/redo, kaydetme, import/export ve solo playtest sunar.
- Custom map multiplayer'da hash/ACK eslesmeden baslatilmaz.
- Shop class kimligi, 3D preview, ozgun ikon ve skin sunar; class runtime statlari gorunen degerlerle uyusur.
- Network iyilestirmeleri gercek paket hizi, RTT, jitter ve frame-time olcumleriyle dogrulanir.

## 3. Tasarim Yonelimi

### 3.1 Tema

Varsayilan dark tema:

- Arka plan: koyu lacivert ve graphite.
- Ana vurgu: mercan/turuncu.
- Bilgi/odak: cyan.
- Takimlar: kontrollu kirmizi ve mavi.
- Basari/uyari/hata renkleri anlamlarini korur.

Soft-spectrum tema:

- Koyu yuzeyler korunur.
- Mor, cyan, pembe, amber gecisleri dusuk doygunluk ve dusuk glow ile kullanilir.
- Surekli rainbow animasyonu kullanilmaz. Renk hareketi yalniz vurgu, hover ve gecis anlarinda olur.

Her iki tema CSS custom property tokenlariyla calisir. `data-theme` Store'a kaydedilir. `prefers-reduced-motion`, high contrast ve color vision secenekleri tema katmanina uygulanir.

### 3.2 Layout

- Ortak ekran kabugu: header, ana icerik, sabit olmayan action footer.
- `clamp()` tabanli tipografi ve spacing.
- Minimum 44px interaktif hedef.
- Safe-area ve viewport yuksekligi `dvh` ile ele alinir.
- Buyuk paneller kendi icinde scroll olur; body veya footer icerigi kapatmaz.
- Settings, scoreboard, lobby, shop, social icin ortak panel ve modal primitive'leri kullanilir.

## 4. Mimari

### 4.1 UI Foundation

Yeni moduler CSS katmani mevcut `style.css` sonrasinda yuklenir:

- `css/ui-tokens.css`: tema, tipografi, spacing, focus, motion.
- `css/ui-shell.css`: screen, modal, panel, header, footer, responsive kurallar.
- Ekrana ozel dosyalar yalniz ilgili component selector'larini tasir.

Mevcut ID ve event baglantilari korunur. Legacy selector cakismalari silinir veya etkisizlestirilir. Aynı selector icin farkli donemlerden kalan konumlandirma kurallari birakilmaz.

### 4.2 Settings

- `#unified-settings` tek settings ekrani olur.
- Legacy `#settings-panel` ve ikinci ayar akisi kaldirilir.
- Ayar metadata'si tek modelde tutulur: id, tab, type, min/max, default, store key, apply callback.
- Her tab tek kolon, ortali, uygun maksimum genislikte render edilir.
- UI scale, theme, crosshair, graphics, gameplay ve accessibility ayarlari ayni persist/apply hattini kullanir.
- Browser'da gercek uygulanamayan VSync davranisi yaniltici bicimde sunulmaz. FPS limit uygulanir veya secenek kaldirilir.

### 4.3 Scoreboard

- Fullscreen overlay `inset: 0; transform: none` kullanir.
- Icerik merkezde, scroll edilebilir, responsive olur.
- Tab keydown acar, keyup kapatir. Pause/chat/console state'leriyle cakisma kurali tek yerde tanimlanir.
- Satirlar `createElement` ve `textContent` ile uretilir.
- Level, ping, team, score, hits, deflects ve damage kararlı veriden gelir; render aninda random veri uretilmez.

### 4.4 Lobby, Quickplay ve Social

- Quickplay gercekten dogrudan varsayilan solo bot lobby'si baslatir.
- Multiplayer ayri "Play Online" girisi olur.
- Lobby map alani gorsel preview, map metadata, secim okları ve filtrelenebilir map strip sunar.
- `[object Object]` ureten size/weather metadata tek formatter ile normalize edilir.
- Chat log ve compose alani footer tarafindan kapanmaz; custom scrollbar ve auto-scroll davranisi olur.
- Host-only kontroller client'ta disabled/hidden olur; yetki yine runtime'da dogrulanir.
- Social formlarinda input `min-width: 0; flex: 1` kullanir. Ekran giris baglamini saklar; Back, geldigi menu veya Social Hub'a doner.
- Local-only clan ozellikleri online vaatlerle etiketlenmez.

### 4.5 Shop ve Class Sunumu

- Sol katalog, orta item grid, sag detay/preview paneli.
- Class karti: renk, rol, stat, pasif, skill, ultimate, sahiplik durumu.
- Preview sahnesi mevcut Three.js asset ve avatar sistemini tekrar kullanir.
- Ozgun class ikonlari ve Minecraftimsi skin texture'lari uretilir; dosyalar local asset olarak paketlenir.
- Asset uretiminden once authoritative class, rune, skill ve ultimate buglari duzeltilir.
- Balance degerleri tek veri kaynagindan UI ve runtime'a akar.

## 5. Crosshair Sistemi

### 5.1 Tek Model ve Renderer

`CrosshairConfig` alanlari:

- style
- color
- size
- gap
- thickness
- dot
- outline
- outlineThickness
- opacity
- dynamicGap

Tek `renderCrosshair(target, config)` fonksiyonu oyun HUD'u ve settings preview icin kullanilir. Tum sayilar finite ve clamp edilmis olur. Renk yalniz hex formatinda kabul edilir.

### 5.2 Console

Desteklenecek komutlar:

- `cl_crosshairstyle`
- `cl_crosshaircolor`
- `cl_crosshairsize`
- `cl_crosshairgap`
- `cl_crosshairthickness`
- `cl_crosshairdot`
- `cl_crosshairdrawoutline`
- `cl_crosshairoutlinethickness`
- `cl_crosshairalpha`
- `cl_crosshair_export`
- `cl_crosshair_import <code>`

Server/game-state komutlari host metadata'siyle isaretlenir. Console execute asamasinda yetki kontrolu uygulanir.

### 5.3 Kod Formati

`2BALL-X1.<payload>.<checksum>`

- Payload canonical JSON'un base64url temsilidir.
- Maksimum kod uzunlugu uygulanir.
- Decode sonrasi strict key whitelist, type, range, version ve checksum kontrol edilir.
- Gecersiz kod Store'u veya aktif reticle'i degistirmez.

## 6. 3D Map Editor

### 6.1 Editor State

Draft state canli `Arena.MAPS` kaydindan ayridir. Kaydetme ve playtest oncesi:

`validate -> migrate -> normalize -> canonical stringify -> hash`

Canonical config:

- version
- id
- name
- baseMapId
- dimensions
- colors
- weather
- flags
- props

Prop alanlari:

- id
- type
- position
- rotationY
- size
- color

Script, URL, external model, custom shader veya executable alan kabul edilmez.

### 6.2 3D Etkilesim

- Ayrı Three.js editor scene ve canvas.
- Orbit ve fly kamera.
- Raycast ile secme/yerlestirme.
- Move, rotate, scale gizmo.
- Grid snap ve axis lock.
- Duplicate, delete, undo, redo.
- Base map secimi: yalniz built-in whitelist.
- Sol palette, merkez viewport, sag inspector, ust toolbar.
- Mevcut Arena compiler ve primitive builder preview/playtest icin tekrar kullanilir.

### 6.3 Kayit ve Paylasim

- Benzersiz `custom-<hash>` ID.
- Maksimum 10 local map.
- Map basina 64 KiB ve 64 prop siniri.
- localStorage quota hatasi gorunur hata verir.
- Kod: `2BALL-M1.<payload>.<checksum>`.
- Import once uzunluk, sonra decode byte limiti, schema, extent, spawn/file/portal safe-zone kontrolleri.

### 6.4 Multiplayer Handshake

1. Host manifest yollar: id, version, byteLength, hash.
2. Eksik client config ister.
3. Host config'i bir kez yollar.
4. Client strict validate eder, session-only register eder, hash ACK yollar.
5. Tum client ACK vermeden custom map maci baslamaz.
6. Red durumunda built-in fallback secilir.

## 7. Social Hub

- Mevcut `SocialLobby` portal callback yapisi korunur.
- Harita daha okunakli bolgelere ayrilir: spawn plaza, portal concourse, practice court, class showroom, map workshop, social lounge.
- Portal isimleri, ikonlari, mesafe promptlari ve hedef ekranleri tutarli olur.
- Pointer-lock, world visibility, menu return context ve presence lifecycle tek state gecis katmaninda yonetilir.
- Dekoratif hareketler reduce-motion modunda durur.

## 8. Network, Tick ve Performans

- 128 Hz browser `setInterval` tickrate iddiasi kaldirilir.
- Varsayilan authoritative simulation 60 Hz fixed timestep olur.
- Hizli collision gereken kisimlar sinirli substep kullanabilir.
- Tek binary ball snapshot hatti kalir; JSON duplicate yol kaldirilir.
- Ball 30-60 Hz adaptive, bot 10-20 Hz, player mevcut hareket durumuna gore 10-60 Hz.
- Event paketleri aninda gonderilir.
- Remote interpolation ve kisa extrapolation korunur; jitter buffer olcumle ayarlanir.
- Debug telemetry: sim Hz, render FPS, RTT, jitter, packet/s, byte/s, dropped/stale snapshots.
- 8 oyuncu temel senaryo; daha buyuk lobby icin full mesh maliyeti acikca gosterilir.

## 9. Balance ve Authority Duzeltmeleri

Gorsel class yenilemesinden once:

- Tank damage reduction tek katmanda uygulanir.
- Remote class/loadout host authoritative state'e uygulanir.
- Remote skill ownership/loadout/cooldown dogrulanir.
- Instagib shield ve reduction'dan etkilenmeden tanimina uyar.
- Skill, passive ve ultimate aciklamalari runtime ile eslenir.
- Volt, Nova ve Ripple icin ultimate, bot havuzu, store ve battlepass entegrasyonu tamamlanir.
- Runtime class degisiminde base statlar temiz resetlenir.

## 10. Hata Yonetimi ve Guvenlik

- P2P oyuncu adi, chat, map adi ve import metni HTML olarak basilmamalidir.
- Host-only komutlar ve lobby aksiyonlari hem UI hem runtime katmaninda kontrol edilir.
- Import islemleri atomiktir; dogrulama tamamlanmadan Store yazilmaz.
- Bilinmeyen schema version ve unknown key reddedilir.
- Texture/asset 404 hatalari temizlenir; eksik asset icin kontrollu fallback kullanilir.
- Global `error` ve `unhandledrejection` gorunur debug paneline aktarilir; production'da hassas stack ifsa edilmez.

## 11. Test ve Dogrulama

Her faz icin:

- `npm test`
- `npm run check`
- Ilgili pure helper testleri
- Browser smoke: 1280x720, 1366x768, 1920x1080, ultrawide
- Keyboard navigation ve focus kontrolu
- Dark/soft-spectrum/high-contrast/reduced-motion kontrolu
- Browser console: yeni JS error ve asset 404 olmamali
- Iki gercek browser peer ile host/client lobby ve custom map handshake
- Network oncesi/sonrasi packet/s, byte/s, RTT, jitter ve frame-time karsilastirmasi
- Screenshot ile settings, scoreboard, lobby, social, shop, editor ve Social Hub gorsel kontrolu

## 12. Uygulama Fazlari

1. UI foundation, tema, settings konsolidasyonu, scoreboard/XSS/console authority.
2. Quickplay, lobby, social, shop shell ve responsive layout.
3. Crosshair renderer, preview, console, export/import.
4. 3D editor, local map repository, map kodu, solo playtest.
5. P2P custom map handshake.
6. Class authority/balance, shop preview, ikon/skin/VFX assetleri.
7. Social Hub harita ve akis yenilemesi.
8. Network duplicate paket temizligi, fixed simulation, telemetry ve polish.

Her faz bir onceki fazin testlerini tekrar kosar. Gorsel kararlar browser screenshot ile kullaniciya gosterilir. Kullanici gorseli onaylamadan kapsam disi polish veya yeni sistem eklenmez.

## 13. Kapsam Disi

- Online public Workshop backend'i, moderation ve cloud storage.
- Dedicated authoritative server rewrite.
- Haritaya script, URL, arbitrary model veya custom shader ekleme.
- Sinirsiz oyuncu veya buyuk MMO hub mimarisi.
- Mevcut Three.js/vanilla JS stack'ini framework ile degistirme.
