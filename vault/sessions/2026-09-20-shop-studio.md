# 2026-09-20 — Shop Studio ve giriş güvenilirliği

Kullanıcı önce oyunu anlamayı, mağazayı okunabilir hâle getirmeyi, yeni içerik ve animasyon eklemeyi istedi; sonra oynanış mekaniklerinin de geliştirilebileceğini belirtti. Çalışma `/volle` üzerinde yapıldı. Aynı klasörde devam eden top yönlendirme, tek vuruş, replay ve lobi değişiklikleri bu çalışmanın sahipliği dışındaydı ve korundu.

## Oyuncunun gördüğü değişiklikler

Mağazada ürün modeli ayrı bir sahnede, animasyon kontrolleri ürün detaylarının üzerinde. Başlık, açıklama, fiyat, bakiye, eksik kredi ve satın alma/takma durumları ayrışıyor. Arama, nadirlik, fiyat sırası, koleksiyon ve ekipman slotu birlikte çalışıyor. Sekme değişince eski arama temizleniyor; aynı sekmede satın alma/takma yenilemesi seçimi ve kaydırmayı koruyor. Kısa masaüstünde katalog başlıklarla birlikte kayıyor; 375 px görünümde çıkış ve bakiye erişilebilir kalıyor.

Court Carnival ve Orbital Club yeni ürünleri tek bir New arrivals bölümünde gösteriliyor; slot listelerinde tekrar edilmiyor. Katalog 88'den 96 ürüne çıktı.

| Ürün kimliği | Kredi |
| --- | ---: |
| `hat_court_carnival_visor` | 240 |
| `backpack_court_carnival_popcorn` | 320 |
| `shoes_court_carnival_rally` | 220 |
| `cape_court_carnival_pennants` | 240 |
| `hat_orbital_club_antennas` | 260 |
| `pet_orbital_club_satellite` | 420 |
| `backpack_orbital_club_star` | 360 |
| `wings_orbital_club_comet` | 480 |

Her ürünün gerçek düşük poligonlu modeli, paletten bağımsız ayırt edilebilir SVG şekli ve eşleşen sunucu fiyat/tür kaydı var. Beşinin mevcut güncelleme kancasını kullanan animasyonu bulunuyor; t=0 nötr konumunu geri kuruyor. Ölçülen ürün maliyeti 4–14 mesh, 10–332 üçgen. Kasa olasılıkları ve ödül miktarları değiştirilmedi.

## Kök neden düzeltmeleri

- Başarılı satın alma sonrasında seçili düğmenin sınıfı `shop-buy` yerine `shop-equip` oluyordu; aynı olay ekipman takma dalına düşüyordu. Satın alma artık işlem sonrasında döner; bekleyen satın alma ikinci isteği engeller.
- Geciken fırsat/satın alma/takma/çıkarma yanıtları artık oyuncunun güncel ekranını ve sekmesini kontrol eder. Gizli mağazayı yeniden kurmaz ve başka sekmeye zorla dönmez.
- Çalışan WebGL önizlemesinin arkasındaki 2D yedek karakter gizlenir; bağlam kaybında yedek yeniden görünür. Top seçimi yalnızca ürün sahnesinde bir renderer kullanır ve karakter animasyonunu durdurur; sekmeden ayrılınca top kaynakları bırakılır.
- Eski şapkaların iki kez eklenen yüksekliği, ters kulaklık yayı, kafa içine gömülen maskeler, ayak hizasına düşen eldivenler ve çantanın yan kapak ekseni düzeltildi. Gerçek Three geometri/soket sınırları test edildi.
- Önizleme Idle/Run/Celebrate kullanır; Front view dönüşü durdurup gerçek ön yüze döner. Gizli/durmuş sahnede çizim ve GPU boyut değişimi yapılmaz. Pointer capture iptali, pencere dışında bırakma ve çift klavye olayları ele alındı.
- Video ayarlarındaki Unlimited değeri `0`, önizleme setter'ında 1 FPS'e sıkışıyordu. ShopShowcase ve MenuStage artık bunu 60 FPS dekoratif tavan olarak yorumlar; açıkça verilen 1 FPS korunur.
- Sohbet veya başka yazı alanına geçince, ya da oyuncunun pointer lock'u kaybolunca, Player mevcut `_clearInputState` yolunu kullanır. Momentum, kabul edilmiş dash, stamina ve cooldown sabitleri değişmedi.
- Voleybol dördüncü temas faulü sayaç artırılmadan reddedilir; son kabul edilmiş temas ve kontrollü self-set bilgisi korunur. DEAD_BALL, POINT_AWARDED ve sonraki servis snapshot aktarımı doğrulandı. `applySnapshot` henüz üretim kodunda çağrılmıyor; bunu canlı çok oyunculu eşitleme düzeltmesi olarak sunma.

## Doğrulama

Son `npm test`: **1852 test, 1852 geçti, 0 başarısız/atlanmış** (`.qa/shop-final-tests.log`). `node scripts/check-js.js`: **110 dosya temiz**. Son UI/akış hedefli paket **28/28** geçti. Ürün testi gerçek sunucu debit, tekrar isteğinde tek işlem, kalıcılık, ownership/slot normalizasyonu, geometri ve kaynak temizliğini çalıştırır. Giriş ve dördüncü temas testleri eski kodda önce başarısız olup düzeltmeden sonra geçti.

Chrome CDP kontrolünde **17 gerçek tarayıcı akış testi** geçti. Ayrıca Characters (10), Skins (20), Cases (6), Boosts (1), Balls (53), Wearables (96), Live Deals (4) ve fırsatlar kullanılamadığında Retry kontrol edildi. 1440×900, 1280×720, 375×812 görüntüleri incelendi; yatay taşma yok, küçük ekranda alt menü 82 px. Reduced motion altında otomatik frame sayısı sabit, normal koşulda Run/Celebrate hareketli. Hata kaydı boş.

Tarayıcı düzeneği `.qa/build-shop-fixture.cjs` ile güncel HTML, UI, Store, renderer ve main olay dallarını kullanır; uygulamayı sahte bir hesapla başlatmaz. Store bellekte tutulur, kayıt/sunucu ekipman senkronizasyonu bağları test düzeneğinde etkisizdir. Gerçek hesapla tarayıcıdan satın alma ve iki tarayıcılı uzun maç bu turda yapılmadı. Yetkili sunucu satın alma yolu ayrı Node testleriyle doğrulandı. Headless ortam varsayılan olarak reduced motion bildirdiği için normal animasyon testi aynı CDP oturumunda no-preference emülasyonu kullanır; ürün bu işletim sistemi tercihini korur.

Yerel kanıtlar: `.qa/shop-browser-report.json`, `.qa/shop-1440x900.png`, `.qa/shop-1280x720.png`, `.qa/shop-375x812.png`, `.qa/shop-final-tests.log`. Bunlar yerel, ignore edilen QA dosyalarıdır. Graft yapısal önbelleği `npm run graft:build` ile güncellendi; derin/ücretli analiz yapılmadı. Bu oturum yeni paket bağımlılığı eklemedi ve commit/push komutu çalıştırmadı.
