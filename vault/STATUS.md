# STATUS — 2026-09-25

> Güncel çalışma: [[sessions/2026-09-25-fun-pass]]. Önceki: [[sessions/2026-09-25-bounded-mobile-perf]], plan `docs/AAA_ROADMAP.md`.

## En yeni — "Oyun sıkıcı" geçişi ([[sessions/2026-09-25-fun-pass]])
- Tanı: kısa ısınma, kolay botlar servisi kaçırıp ölüyordu. Botlar artık açılış servisini karşılıyor.
- **Bedava kasalar:** her 3 maçta 1 kasa (5 kez), seri 3/5/7. günlerde ek kasa. Sunucu otoritesinde, menüde ilerleme kartı var. Misafire hesap istemi çıkıyor.
- **Kill efektleri:** öldürene seri madalyası (double → rampage, kafa, perfect) ve öldürme noktasında uzaktan okunan ışık sütunu.
- **Sohbet filtresi** EN/TR (varsayılan açık, Oynanış ayarından kapanır). **Global chat** ana menüde: host'un tek tık lobi daveti, Join/Copy, lobide kod kopyala/paylaş.
- **Harita kodları:** editörde kodu kopyala/yükle, lobide kodu yapıştırıp o haritada oyna. Sunucuda saklanmıyor, kod doğrulanıyor.
- **Görünürlük:** uzak top ≥12 px işaret, rakip başında takım renkli ok. **Akıcılık:** maç başı shader ön-derleme; maç ortası derleme donmaları 3 maçta 5 → 0 (en kötü 442 ms).
- **CS:GO tarzı droplar:** zarlar oyuncu başına, maç başı %20 ekstra kart, kendi dropun sağda, başkalarınınki solda, maç sonunda "Herkesin dropları" listesi.
- **Tempo:** raund arası 3 sn, soloda Boşluk ile atlanıyor. **Bot doldurma:** casual online lobide boş yerler botla doluyor (≥2v2), ranked'de asla.
- `sfx/tf2_*.mp3` TF2 kaynaklı; sahip bu sesleri tutmaya karar verdi.
- Doğrulama **2624/2625 test** (+1 skip), check 154 dosya OK. Dal main'e birleşmedi.

## En yeni — Sınırlı döngü: mobil + ilk yükleme ([[sessions/2026-09-25-bounded-mobile-perf]])
- Sözleşme önceden yazıldı (sabit hedef, kanıt, değişmezler, tur limiti, ayrı commit). main'in çevrimiçi oyun düzeltmesiyle birleştirildi.
- **Mobil geçti:** 4 cihazda dokunmatik E2E (yürüme/bakış/deflect, hata yok, HUD tuşların üstünde değil). Hoş geldin kartı dokunmatik metin + kısa ekrana sığıyor; drill paneli, ultimate halkası, hız hapı tuşlardan çekildi.
- **Performans:** JS hedefi platoda kaldı (three.js ağaç sallaması, 618 → 590 KiB brotli). Ölçüm asıl yükün JS olmadığını gösterdi; sahibin onayıyla hedef "ilk açılış toplam bayt" oldu: **2046 → 1034 KiB (−%49,5)** — kupa maçla yükleniyor, küçük logo, gizli ekran görselleri lazy.
- Doğrulama: **2575/2575 test** (+1 skip), `npm run check` 145 dosya OK.

## En yeni — Arkadaşla oynama ([[sessions/2026-09-24-p2p-guest-join]])
- main'deki çevrimiçi oyun düzeltmesi (misafir lobi oturumu, WebSocket relay, TURN, admission yeniden deneme; `docs/NETWORKING.md`) esas alındı. Bu dalın "admission'ı atla / listesiz oda" yaklaşımı birleştirmede bırakıldı.
- Bu daldan kalanlar: kimliği bilinmeyen konum paketi atılır (hayalet "P-xxxx" yok), host istemcinin paketteki takımına güvenmez, takım isteği `playerId` ile eşleşir (aynı isimli oyuncular), kodla katılımda boş isim → profil adı, M menüsünde 1/2 tek tuşla geçiş.

## En yeni — Playtest geçişi ([[sessions/2026-09-23-playtest-pass]])
- Harbor gece gökyüzü beyaz lekeleri (bulut shader'ı), menü social rail çakışması, lobi buton yerleşimi, maç sonu görseli, Esc ile geri, maç sonu harita değişiminde lobi senkronu, lobi EN/TR.
- Doğrulama **2273/2273 test**, build OK, commit `b847617` main'e gönderildi.

## En yeni — AAA geçişi 2–3 ([[sessions/2026-09-23-aaa-overhaul-pass2]])
- Ayrı viewmodel katmanı (FOV 60, stüdyo yansımaları), yeni eldivenli el, anahtar kareli CS2 tarzı animasyonlar (inspect varyantları, R twirl), 5 yeni bıçak modeli, sentez bıçak sesleri.
- 24 eldiven, Glovebox + Blade Vault kasaları, S/A/B/C tier + Tier List, gerçek 3D ürün görselleri ve 3D kasa açılışı, MVP ekranı.
- İzleyici modu (POV/tribün, emote), karşı saha kuralı, emote çarkı 5 hata düzeltmesi.
- Netcode: interpolasyon, saat senkronu, binary codec, net_graph. 3 yeni harita + 8 harita cilası, daha az draw call.
- esbuild paketi + brotli: ilk yükleme JS 132 istek/~4,2 MB → 8 dosya/~0,55 MB. Ayarlar menüsü yeniden düzenlendi.
- Doğrulama **2179/2179 test**, 129 JS dosyası, üretim build'i OK.

## En yeni — AAA geçişi 1
- **Kritik güvenlik:** statik sunucu `data/accounts.db`, `.git`, `server/` dosyalarını sunuyordu; artık izin listesi + Docker `DATA_DIR=/data`.
- Misafir girişi, ilk açılış eğitimi, yeni oyuncu kilitleri, tek marka VOLLE, yükleme ipuçları.
- Viewmodel varsayılan açık; nadirlik efektleri (rim/iz/kıvılcım), deflect geri tepmesi, kasadan "Try in hand".
- Günlük giriş/ücretsiz kasa sunucuda; combo hasar hatası; CI test kapısı; loot-box yasal kuralı testte.
- Stereo ses, kenar vignette, rally hız tavanı + overdrive, 4 haritaya gerçek layout, 3D-imsi menü.
- Doğrulama **2004/2004 test**, 111 JS dosyası. Kalanlar oturum notunda.

## Önceki durum (2026-09-20)
## En yeni tamamlanan çalışma — oynanış ve Arcade
- Botlar mevcut duvar/sütun çarpışmalarını gözetiyor; normal harekette yerel engel dolanma ve sınır içinde doğum kurtarma var. FFA yarı saha kısıtı kalktı; takım modları korunuyor. Bu, tam rota planlama değil.
- Ölü bot hareketi duruyor; chill oyuncudaki gibi %20 yavaşlatıyor; geçersiz hareket değerleri reddediliyor. Bot isim/avatar/can barı kaynakları bir kez temizleniyor. Top fiziği ve zorluk olasılıkları değiştirilmedi.
- Arcade: Bot Matches, Guided Deflect, Free Lab ve açıkça yerel etiketli Volleyball Drill. Önceden butonu eksik üç solo seçenek erişilebilir. Kartlar kayarken Back görünür kalıyor; süre açıklaması maç genelini belirtiyor.
- Son tam test **1954/1954**, sıfır başarısız/atlanmış; **110 JS dosyası** temiz. Bu tur 20 regresyon ekledi; paralel servis/HUD testleri de toplamda yer alıyor. Graft wiring kontrolü geçti.
- Gerçek uygulama tarayıcı kontrolü: 3 ekran boyutu, 3 solo seçeneğin hazırlanması, üç raundluk maç ve 0-0/ilk raund rövanş. Yerel voleybolda servis ve Esc çıkış çalışıyor. Yakalanan sayfa hatası yok; insan oynanış dengesi veya iki gerçek oyunculu ağ testi yapılmış sayılmaz.
- Kalan öncelikler: daha anlamlı ralliler/takım kararları, karmaşık engellerde rota, voleybolda konum/erişim tabanlı temas ve canlı çok oyunculu doğrulama. Kanıtlar `.qa/owner-browser-report.json`, `.qa/owner-final-tests.log` ve oturum notunda.

## Önceki çalışma — ayarlar ve güvenilirlik
- Grafik ayarları: sabit başlık/sekmeler/Done, tek içerik kaydırması, kalite ve ekran grupları; ses ayarları Controls içinde. Mobil sıra/taşma ve slider-değer çakışması düzeltildi; klavye sekmeleri ve odak yönetimi eklendi.
- Bot yetenekleri ve uzaktaki oyuncuların bekleme süreleri çalışıyor; ölü/gecikmiş istekler maç durumunu bozamıyor. Host, hareket paketinden HP/dirilme kabul etmiyor. P2P kaçırılan vuruşları iki tarafta da yalnız geri bildirim; gerçek hasar host tarafından veriliyor.
- Yeniden bağlantı girişimleri 5 saniyede sonlanıyor; düşük kalite gerçek çizim hedeflerine uygulanıyor, harita bloom'u tekrar açamıyor.
- XP artırıcı sunucu satın alma/kalıcılık/tekrar deneme ile çalışıyor. Sıralama yerel ve örnek rakiplerini açıkça etiketliyor; FPS/kayıp ölçümleri yanıltıcı değer göstermiyor.
- Son tam test **1917/1917**. Ayarlar tarayıcı **39 kontrol**, dört boyut + %120 ölçek. Gerçek hesap satın alma E2E, uzun P2P oturumu ve GPU hız artışı bu turda ölçülmedi.
- Öncelikli kalan işler: eksik rakip sonuç bildiriminin maç/ödül kilidi, doğrulanmış yetenek ekipmanı metadatası, mesh kaynak denetimi ve gerçek oyunculu oyun hissi testi.

## Son tamamlanan çalışma
- Mağazada okunabilir ürün detayları, koleksiyon/slot filtreleri, kalıcı seçim ve kaydırma, mobil alt menü, Idle/Run/Celebrate önizleme kontrolleri.
- Court Carnival ve Orbital Club: 8 yeni model/SVG/sunucu kaydı; 220–480 kredi; toplam 96 giyilebilir kozmetik.
- Satın almanın yanlışlıkla ekipman takmasına, çift isteğe, geciken yanıtların sekmeyi değiştirmesine ve çift 2D/3D önizlemeye yol açan hatalar düzeltildi.
- Eski şapka/maske/eldiven yerleşimleri, Unlimited seçiliyken 1 FPS önizleme, sohbet açınca basılı kalan girdiler ve voleybolun reddedilen dördüncü temas durumu düzeltildi.
- Doğrulama: **1852/1852 test**, **110 JS dosyası**, **17 tarayıcı akış kontrolü**, 7 sekme + fırsat yok durumunda tekrar deneme; 1440×900, 1280×720, 375×812 görselleri incelendi.
- Tarayıcı akışı izole bellek verisiyle gerçek üretim UI/render/olay kodunu çalıştırdı. Sunucu satın alma/kalıcılık ayrı test edildi; bu turda gerçek hesapla uçtan uca satın alma veya iki kişiyle uzun maç testi yapılmadı.
- Aynı klasördeki paralel top/maç/replay/lobi çalışmaları korundu. Bu çalışma yeni bağımlılık eklemedi; kalan inceleme için `.qa/shop-browser-report.json` ve oturum notuna bak.

## Önceki oturum notları — 2026-07-31 arşivi

> Aşağıdakiler önceki oturumun kayıtlarıdır; ayrıntı [[sessions/2026-07-31-fable]] + `MIMO.md` Wave 7-8.

## Bitti ve pushlu
- `1741825` — Faz 1: ball stall fix (isHost&&!connected sim boşluğu), host/late-join 4 kök neden (lobi unregister, TTL 45→90s, rate limit 30→120/dk, peer-unavailable listener), QUICK PLAY hub reroute, skybox revert.
- `17218aa` — Faz 2 A-D: post-match ödül akışı, menü retention strip, FTUE, 4 yeni arena (aquarium/museum/casino/subway), Aurora Grand Plaza (3 eski hub silindi), ball shape skinleri + 3 yeni bıçak + Dark Eater seti, Roblox mitt viewmodel, vault kurulumu.
- Final commit (bu kapanış): Wave E — 7 farklı bıçak silüeti (öncesinde hepsi aynıydı), ball shape 2D badge + gerçek geometri 3D inspect, CS tarzı inventory grid, HUD sheen/score-pop/low-health vignette, ayarlar polish, patch notes v0.11; MIMO Wave 8; graphify güncellemesi. Suite: 1272/1272.

## Doğrulama kanıtları
- Full suite orchestrator tarafından bizzat: **1272/1272**. `check-js` 94 dosya temiz.
- Canlı smoke: Aquarium map yüklendi (48 animatör tick), maç oynadı, top hareketli, sıfır console hatası; retention strip + FTUE overlay + patch notes 2026-07-31 + `hubMaps=['plaza']` DOM'dan doğrulandı.
- graphify: 6320 node / 12796 edge / 436 topluluk, health OK, `graphify-out/GRAPH_REPORT.md` + aggregated `graph.html` güncel.

## Açık işler (sonraki oturum)
- MP client post-match XP kaynak satırları — host `xpSources` broadcast etmeli.
- Countdown warmup topu hedefsiz süzülüyor, botlar donuk (tasarım gereği; stall'a benziyor, şikayet gelirse burası).
- `initPeer()` timeout yok — broker asılırsa host akışı sessiz bekler.
- Alt-tab'da non-host solo maç donuyor (RAF durur) — yapısal.
- Battlepass tier-up kutlaması yok.
- Gerçek iki-browser WebRTC testi yapılmadı (STUN-only, PeerJS cloud broker) — host/join fixleri kod-iz + registry testleriyle kanıtlı, canlı çift-taraf oynanış insan testi istiyor.
- Animasyonlar (score pop, HUD sheen, vignette) sandbox reduced-motion zorlaması yüzünden pixel olarak görülmedi — gerçek ekranda bir bakış iyi olur.

## Ortam notları
- Smoke tekniği + omp session yolu + test glob: bkz [[sessions/2026-07-31-fable]].
