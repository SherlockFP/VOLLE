**Özet:** Three.js ile yapılmış 3D First-Person dodgeball oyunu. TF2 tarzı cartoonish grafikler, P2P multiplayer, skill-based gameplay.
**Kütüphaneler/Teknolojiler:** Three.js, PeerJS, WebRTC, Canvas API
**Bağlantılar:** [[Player_Controller]], [[Ball_Physics]], [[Arena_System]], [[Bot_AI]], [[CSGO_Lobby]]

## Oynanış
- Oyuncular 2 takıma ayrılır (Kırmızı vs Mavi)
- Top rakibe vurunca oyuncu ölür, round biter
- Her deflect top hızını artırır (speed ramp)
- Flick mekaniği: aşağı flick = spike, yukarı flick = lob
- Stamina spam koruması: her deflect stamina harcar

## Kontroller
- WASD hareket, Space zıplama
- L-Click topu deflect et
- Flick yukarı lob, aşağı spike
- Q aktif skill, B top skin değiştir
- Y sohbet, M takım popup, Tab skor tablosu

## Son Güncellemeler (07/2026)
- CS:GO stili lobby yenilendi: takım kolonları, avatar kartları, altta ayarlar
- Settings: çözünürlük, VSync, FPS limit eklendi
- El clipping fix: kol kameraya yaklaştırıldı, radius büyütüldü
- Tree/prop collision: toplar ağaç/sütun/heykellere çarpıp sekiyor
- Avatar sprite: karakterlerin üstünde emoji avatar gözüküyor
- Ball skin picker: B tuşu ile top skin değiştirme
