**Özet:** CS:GO/Overwatch tarzı tam ekran lobby. 3 kolonlu layout: sol kırmızı takım, orta harita/ayarlar/chat, sağ mavi takım.
**Kütüphaneler/Teknolojiler:** CSS Grid, Flexbox, HTML5 Drag & Drop API
**Bağlantılar:** [[DODGBALL]], [[Settings_System]], [[Avatar_Painter]]

## Layout
- **Top bar:** Room code + map/mode info + Leave butonu
- **Body:** 3-column CSS Grid (1fr 1.6fr 1fr)
  - Sol: Kırmızı takım — oyuncu kartları (avatar, isim, karakter emoji, bot kick butonu)
  - Orta: Map carousel (gradient preview, weather/size badges, left/right arrows, dots), Mode select, Settings button, **Chat panel**
  - Sağ: Mavi takım — oyuncu kartları
- **Bottom bar:** Start Game butonu, spectate, bot remove, random map, bot count

## Player Cards
- Avatar (daire içinde pixel art veya emoji)
- İsim (kendininki sarı renk)
- Karakter emoji + isim alt satırda
- Bot'lar yarı saydam gösterilir
- **Bot kick butonu**: Host için bot kartlarında ✕ butonu (sağ üst köşe)
- **Drag & Drop**: Host, oyuncu kartlarını sürükleyerek diğer takıma taşıyabilir

## Chat (Lobby)
- Center kolonda, Settings altında **chat paneli** her zaman görünür
- Chat log + input + send butonu
- Gelen mesajlar hem lobby chat'te hem de oyun içi overlay'de görünür
- Lobby'de Y/T/Enter → lobby chat input'u focus'lar
- Oyun içinde Y/T/Enter → floating chat overlay açar

## Host Özellikleri
- **Drag & Drop**: Oyuncu kartlarını diğer takıma sürükle → `game.switchPlayerTeam(name, team)` çağrılır
- **Bot Kick**: Bot kartındaki ✕ butonu → `game.removeBotByName(name)` çağrılır
- Host kontrolü `network.isHost` ile yapılır

## Yenilikler
- Eski dikey panel lobby tamamen kaldırıldı
- Ayarlar artık accordion değil, **unified settings modal** (3 section: Controls, Display, Gameplay)
- Ban menu kaldırıldı
- Map seçimi: emoji grid yerine **carousel** (gradient preview, weather/size badges)
