# 2026-09-24 — Arkadaşla oynama (P2P katılım) + takım değiştirme

Önceki: [[2026-09-23-playtest-pass]]. Bu oturumdan önce main'e giren ama STATUS'a yazılmamış işler:
takım renk paleti + M menüsü kuralları (`dc39743`), menü "de-AI" geçişi (`399b9bf`), Locker yenilemesi (`dbb7c3d`).

## Şikâyet
"Arkadaş lobime giremiyor, *admission proof* hatası veriyor; misafirle de oynayabilelim; takım değiştirmek zorlaşmış; volle.onrender.com'dan eskiden bağlanıyordu."

## Kök nedenler
- **Misafir host** (`3f93f1d`, 09-23): `_doHostGame` hesapsız oyuncuyu P2P oda açmadan *yerel botlu lobi*ye atıyordu → arkadaş bağlanacak oda yok.
- **Kayıt başarısız** (401 / servis yok) → aynı yerel lobiye düşüş. Render'da oturum verisi silinirse (deploy, disk yok) hesaplı host da buna düşer.
- **Katılan**: `_confirmLobbyAdmission` proof gelmezse ya da `/join` reddederse *throw* → "Failed to join: Lobby admission proof was not received". P2P bağlantı açık olsa bile katılım iptal.
- **Hayalet oyuncu**: POS_Q playerId'yi 32 pakette bir taşıyor; id bilinmeden gelen host paketi peer-id ile yeni oyuncu açıyordu ("P-817e", mavi takımda host kopyası).
- **Takım**: host, istemcinin konum paketindeki `team`'i sorgusuz alıyordu (sıra kuralını atlatır, raund başında roster ayrışır). Takım isteği isimle eşleşiyordu; kodla katılan herkes varsayılan "Player" adını alıyordu → aynı isimde host kendini değiştirebiliyordu. M menüsü mevcut takım seçili açılıyordu → önce diğerini seç, sonra onayla.

## Yapılanlar (commit: bu dal `claude/keen-mendel-wce2hx`)
- Host her zaman P2P oda açar; listeye kayıt best-effort. Misafir/oturum düşmüş/servis yok → oda kalır, kodu gösteren toast (`toast.lobbyPrivate*`, EN/TR). `_openLocalLobbyFallback` silindi.
- Katılım: sunucu admission sadece ödül üyeliği; misafir atlar, hata atmaz, geç gelen proof `network.onLobbyAdmissionProof` ile yine kullanılır. Token'sız welcome beklemeyi anında bitirir (`_settleLobbyAdmissionUnlisted`).
- `_applyPositionPacket`: host relay'de id yoksa roster'dan çöz, yoksa paketi at.
- Host takım otoritesi; host'un reddettiği geçişte istemci host'un yarısına respawn olur. `switchPlayerTeam(name, team, playerId)`.
- Kodla katılımda isim profil/misafir adından (`join-name-input` boş varsayılan).
- M menüsü: diğer takım seçili açılır, **1/2 tek tuşla geçirir**, seçili başlığa tekrar tıklamak onaylar.

## Doğrulama
- `npm test` **2546 test, 2545 geçti, 0 hata** (1 atlanan önceden de vardı); `npm run check` 143 dosya OK. Yeni: `tests/p2p-join-guest.test.mjs`; `tests/lobby-admission-race.test.mjs` yeni niyete göre yazıldı.
- **Gerçek iki tarayıcı** (Playwright + yerel PeerJS broker `peer@1`, 127.0.0.1:9000; sunucu `PEER_HOST=localhost PEER_PORT=9000 PEER_PATH=/ PEER_SECURE=false STUN_URLS=stun:127.0.0.1:3478`): misafir+misafir, hesap host+misafir, hesap+hesap. Lobi butonlarıyla takım iki yönlü senkron; maçta M→1 çalışıyor; hayalet oyuncu yok; sayfa hatası yok.
- Not: `STUN_URLS=` boş verilirse istemci 0.peerjs.com'a düşer (sanitize boş ICE'yi reddediyor). Broker CLI IPv6'ya bind edip patlıyor → `require('peer').PeerServer({host:'127.0.0.1'})`.

## Açık / sahibin yapması gereken
- **TURN yok** (sadece STUN): sıkı NAT/mobil ağlarda iki oyuncu hâlâ bağlanamayabilir. `TURN_URLS` + `TURN_SECRET` (coturn) ya da `TURN_USERNAME/TURN_CREDENTIAL` env'leri destekleniyor (`server/rtc-config.js`).
- Render: kalıcı disk + `DATA_DIR` ayarlı değilse her deploy oturumları siler (render.yaml'da tanımlı; servis blueprint'ten kurulmadıysa uygulanmamış olabilir). Lobi listesi bellek içi.
- Hesaplı host + misafir oyunda `/api/matches/start` 403 (lobi üyesi <2) → host'a sunucu maç ödülü yok. Tasarım gereği; istenirse misafirleri sayan bir "casual" yolu düşünülebilir.
- Canlı siteye (volle.onrender.com) bu ortamdan erişilemedi; deploy sonrası gerçek iki cihazla bir kez denenmeli.
