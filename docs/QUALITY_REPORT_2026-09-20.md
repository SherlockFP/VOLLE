# VOLLE kalite ve doğrulama raporu — 20 Eylül 2026

## Değerlendirme

Kullanıcının başlangıç puanı: **3/10**. Bu tur sonu benim geçici ürün değerlendirmem: **7,5/10**. Menü/mağaza kullanılabilirliği yaklaşık **8,5/10**; oyunun tamamına 8 vermek için yeterli kanıt yok. Bu puan otomatik test skoru değil, öznel ürün değerlendirmesidir.

8/10 hedefinin kalan önemli koşulları: iki gerçek oyuncuyla ağ gecikmesi altında tam maç/rematch testi; farklı donanımlarda FPS ve giriş gecikmesi ölçümü; daha uzun insan oynanışıyla deflect okunabilirliği ve bot dengesi. Volleyball hâlâ yerel antrenmandır, tamamlanmış çevrimiçi voleybol modu olarak sunulmamalıdır. Görsel kimlik ve Türkçe/İngilizce tutarlılığı da ek çalışma ister.

## Astra arayüz ve son doğrulama döngüsü

- Ana menü ve ortak ekranlar Astra tarafından yeniden düzenlendi: VOLLE sahnesi,
  sekiz görünür rota, Solo seçim kartları, mağaza, locker, ayarlar, sosyal,
  ilerleme, antrenman ve maç sonucu yüzeyleri aynı hiyerarşiyi kullanıyor.
- 1280×720 ana menü ve mağaza; 375×812 ana menü; Solo seçim dialogu; Locker;
  ayarlar; Court Skills sayacı, kişisel rekor alanı ve restart akışı canlı tarayıcıda
  kontrol edildi. Mobil menüde üst navigasyonun hero ile çakışması düzeltildi.
- FPS seçicisinin yenileme sonrası 60'a dönmesi düzeltildi; kayıtlı 30 değeri Video
  sekmesinde geri yükleniyor. Önizleme döngüleri ve oyun render limiti bu ayarı
  kullanıyor. Tarayıcı QA'sında ayar 30 FPS olarak bırakıldı.
- Son tam test: **1.793/1.793**, odaklı regresyon kümesi **40/40**, JavaScript
  sözdizimi **110 dosya**. Graft kontrolü npm önbelleğinde paket bulunmadığı ve
  yükseltilmiş ağ komutu kullanım kotasına takıldığı için yenilenemedi.

## Bu tur yapılanlar

- Ana menüye doğrudan Solo vs Bots girişi eklendi. Daraltılmış sosyal panelin karakteri kaplayan boş alanı düzeltildi. Yerel lobide doğru LOCAL · VS BOTS bilgisi gösteriliyor.
- Mağazaya kelimeli arama, nadirlik ve ekipman yuvası filtreleri, fiyat/isim sıralaması, boş sonuç ve filtre temizleme akışı eklendi. Canlı tekliflerin gerçek nadirliği filtreleniyor. Kazanılmış ücretsiz kasa hakkı uygun fiyat filtresine doğru yansıyor.
- Karakter portrelerinin kırpılması, kozmetik açıklamalarının düğmelerle çakışması ve dar ekran mağaza panellerinin birbirini ezmesi düzeltildi.
- Solar Circuit ve Tidal Drift koleksiyonlarında 12 kozmetik eklendi; giyilebilir katalog 76'dan 88'e çıktı. Kulaklık ve spor çantası için ayrı 3D biçimler eklendi. Kozmetik çıkarmada socket temizliği düzeltildi; istemci/sunucu katalogları eşlendi.
- Rakibin öldürmesini oyuncunun kendi kombo başarısı gibi gösteren bildirimler düzeltildi. Kişisel ölümde kombo sıfırlanıyor; maç efektleri menüye taşmıyor.
- Replay açı geçişi düzeltildi. Snapshot verisi yalnız kayıt gerektiğinde hazırlanıyor. Menü/mağaza önizlemeleri 60 çizim/sn bütçesine alındı; kapalı/gizli önizleme yaşam döngüsü ve piksel bütçesi iyileştirildi. Oyun içi FPS tercihi korunuyor.
- Volleyball antrenmanı metin alanına yazılan kontrol tuşlarını oyun komutu olarak işlemiyor.

## Kanıt

- Son tam otomatik test: **1.766/1.766 geçti**, başarısız/atlanmış test yok. JavaScript sözdizimi: **105 dosya** geçti.
- Volleyball deterministik oynanış: 30/60/144 FPS simülasyonlarının her birinde 30 ralli, toplam **90 ralli**. Her koşuda 15–15 puan, 465 oyuncu teması, 420 feeder teması; düşen/bekleyen komut sıfır. Blok, kaçırma, yeniden başlatma ve metin girişi senaryoları ayrıca geçti. Bunlar insan playtesti değil, simülasyon testleridir.
- Performans davranış testi: 60/144/240 Hz girişte replay snapshot oluşturma saniyede 8; önizlemeler saniyede 60 çizim. Bu GPU süresi veya gerçek cihaz FPS karşılaştırması değildir.
- Tarayıcı: oturum geri yükleme; 1280×720 mağaza araması ve Solar Circuit Headset gerçek 3D önizlemesi; 375×812 katalog ve önizleme akışı; doğrudan bot lobisi, Instagib başlangıcı/raunt ilerlemesi/duraklatma/menüye çıkış; Volleyball servis, kontrol tuşları, restart ve çıkış denendi. Kontrol sırasında tarayıcı hata/uyarı günlüğü boştu.
- Satın alma/kuşanma ve istemci-sunucu fiyat eşleşmesi otomatik testlerle doğrulandı. Bu tur gerçek para işlemi yapılmadı. İki cihazlı çevrimiçi maç, mikrofon ve uzun süreli bellek profili doğrulanmadı.

## Çalıştırma ve teslim

Proje klasöründe `npm start`, ardından http://localhost:8000/. Bilgisayar kapanırsa sunucuyu yeniden başlatmak gerekir. Yerel deneme hesabı ve QA günlükleri Git dışında tutulur. Yeni runtime bağımlılığı eklenmedi; değişiklikler commit/push yapılmadan çalışma klasöründe bırakıldı. Blender MCP bu oturumda erişilebilir olmadığı için kullanılmadı.


## İkinci tur — oynanış genişlemesi

İlk değerlendirmeden sonra Court Skills eklendi: ana menüden tek giriş, dört sıralı hedef (3 servis, 5 karşılama, 3 karşılama/pas/smaç zinciri, 2 blok), geçerli temas bildirimi ve ralli istatistikleri. Hedefler fizik motorunun kabul ettiği temaslara bağlıdır. Blok aşamasının tamamlanabilmesi için varsayılan top besleyicinin ralli düzeni uzatıldı; fizik sabitleri değiştirilmedi. Entegre otomatik koşu 6 rallide 75 oyuncu temasıyla hedefleri tamamladı. Simülasyondaki yaklaşık 56 saniye, insanın tamamlama süresi değildir.

Voleybol sahasına ayrı turkuaz yüzey, hücum çizgileri, ağ/direkler, şeritli top ve topun mevcut konumunun yere izdüşümünü gösteren halka eklendi. Halka tahmini düşüş noktası değildir. HUD merkezden kenarlara alındı; sonraki temasın tuşunu ve amacını açıklıyor. 13 kozmetik türüne ayrı SVG çizimleri, kulaklık/çanta/pet çeşitlerine özel şekiller geldi. Kompakt masaüstünde ürün resmi, açıklaması ve düğmeler birlikte görünür.

Son tam test: **1.780/1.780**. Son geometri/kart rötuşlarından sonra ilgili **10/10** test yeniden geçti. **108 JS dosyası** sözdizimi kontrolünden geçti. Canlı tarayıcıda hedefin geçerli serviste 1/3 olması, file/zemin/şeritler, mağaza çizimleri ve 375×812 HUD kontrol edildi; hata/uyarı günlüğü boştu. Dar ekran kontrolü dokunmatik oynanış desteği iddiası değildir.

Geçici ürün puanım bu genişlemeyle **7,5/10**. 8 hedefini yalnız yeni özellik sayısına bakarak ilan etmiyorum: gerçek oyunculu maç/uzun oynanış ve donanım performans kanıtı hâlâ eksik.
