# DODGBALL — Espor Oyununa Dönüşüm Planı

> **Durum**: Aktif geliştirme. Bu plan, tokenler biterse başka AI'lerin/devralabilir.
> **Yaklaşım**: Ponytail — en kısa çalışan diff, stdlib önce, mevcut kodu genişlet.
> **Oyun**: 3D first-person dodgeball, Three.js + PeerJS, browser-based.

---

## Mevcut Durum (Phase 0 — Tamam)

- ✅ 4 map: Beach, Factory, Space, Neon (`arena.js` MAPS)
- ✅ Bot AI (`bot.js`) — easy/medium/hard
- ✅ P2P multiplayer PeerJS (`network.js`)
- ✅ HP/shield/stamina temel (`player.js`, `bot.js`)
- ✅ Store: currency/xp/level (`store.js`)
- ✅ Minimap, chat, scoreboard, countdown
- ✅ Toon shader + outline (`renderer.js`, `shaders/`)
- ✅ Ball: aim-based deflection, spike/lob/flat, trail, glow (`ball.js`)

---

## Phase 1 — Çekirdek Sistemler (YÜKSEK ÖNCELİK)

### 1.1 Karakter Sistemi — `js/characters.js` (YENİ)

Karakter başına statlar + pasif yetenek. League of Legends tarzı.

```js
export const CHARACTERS = {
  rally:    { name:'Rally',    maxHp:100, speed:10, deflectPower:1.0,  passive:'none'        },
  tank:     { name:'Bulwark',  maxHp:150, speed:8,  deflectPower:0.9,  passive:'damage_reduc' },
  scout:    { name:'Scout',    maxHp:80,  speed:13, deflectPower:1.1,  passive:'fast_stam'    },
  sniper:   { name:'Sniper',   maxHp:90,  speed:9,  deflectPower:1.3,  passive:'spike_bonus'  },
  guardian: { name:'Guardian', maxHp:120, speed:9,  deflectPower:1.0,  passive:'shield_regen' },
};
```

- `player.applyLoadout(charId)` → statları uygula
- Store'da `unlockedChars` zaten var, `rally` default
- Bot'lara da karakter ata (random)

### 1.2 Skill/Rune Sistemi — `js/skills.js` (YENİ)

Aktif skill (Q tuşu) + pasif rune'lar. LoL rune tarzı 4 slot.

**Aktif Skiller:**
| Skill | Etki | Cooldown |
|-------|------|----------|
| `slow` | Topu 2sn %50 yavaşlat | 8s |
| `freeze` | Topu 1.5sn dondur | 12s |
| `burn` | Hedefe 3sn boyunca 5 dmg/s | 10s |
| `shield` | 25 kalkan | 8s |
| `smash` | Topa +30% hız vur | 10s |
| `heal` | +20 HP | 15s |

**Rune Slotları (pasif):**
- HP Bonus (+25 max HP)
- Damage Resist (-15% alınan hasar)
- Deflect Power (+15% deflect gücü)
- Speed Bonus (+15% hareket)
- Stamina Regen (+50% stamina yenileme)
- Cooldown Reduction (-20% skill cooldown)

`player.useSkill(skillId)` → cooldown + etki uygula.
`player.applyRunes(runeLoadout)` → stat bonusları.

### 1.3 Hasar Sistemi İyileştirme — `player.js` / `bot.js` / `game.js`

**Consecutive miss ramp (zaten kısmen var):**
```
tutamama sayısı → ekstra hasar
0 miss  → base damage (25)
1 miss  → +5 (30)
2 miss  → +10 (35)
3+ miss → +20 (45) "CRITICAL"
```

- `handleHit()` içinde `target.consecutiveMisses` oku
- Başarıyla deflect edince `consecutiveMisses = 0` sıfırla
- HP 0'a düşünce öl, round bitir
- Bot'lar HP bar'ı zaten çiziyor (`drawHpBar`), player için `#vitals` zaten var

**Damage meter:** HUD'a DPS/total damage ekle (`scoreboard.js` + `ui.js`).

### 1.4 Spam Protection — `player.js`

Mouse 1 spam ile topu sınırsız atamama:
- **Stamina tabanlı attack**: Her deflect 25 stamina harcer
- Stamina 0'sa attack yapamaz (zaten `stamina` var `#vitals`'da)
- Stamina 35/s yenilenir
- Cooldown 0.2s zaten var, ekstra stamina gate ekle
- `player.canAttack` = `stamina >= 25 && attackCooldown <= 0`

### 1.5 Map Banlama — `index.html` lobby + `game.js`

LoL tarzı: her takım 1 map banler, kalanlardan random seç.
- Lobby'e "Ban Map" bölümü ekle
- `game.bannedMaps = []`
- Ban butonu → map'i banned listeye al, disable et
- Start game → banned olmayanlardan random veya host seçer

---

## Phase 2 — İçerik (ORTA ÖNCELİK)

### 2.1 Yeni Mapler + Büyük Mapler — `arena.js` MAPS genişlet

Mevcut 4 map → 10+ map. Daha büyük court'lar.

| Map | Tema | Boyut | Özel |
|-----|------|-------|------|
| beach | 🏖️ Plaj | 78x54 | Okyanus, palmiyeler |
| industrial | 🏭 Fabrika | 72x50 | Metalik |
| space | 🚀 Uzay | 84x58 | Yıldızlar, düşük gravite |
| neon | 🌆 Neon City | 78x54 | Glowing billboards |
| **dojo** | 🥋 Dojo | 90x62 | Ahşap, fenerler |
| **colosseum** | 🏛️ Kolezyum | 100x70 | Antik taş, geniş |
| **volcano** | 🌋 Volkan | 88x60 | Lav, ateş efekti |
| **ice** | ❄️ Buz Sarayı | 82x58 | Kaygan zemin, buz parçacıkları |
| **cloud** | ☁️ Bulut | 95x65 | Yumuşak, düşük gravite |
| **jungle** | 🌴 Jungle | 92x64 | Ağaçlar, nehir |
| **cyber** | 🤖 Cyber | 80x56 | Hologramlar, grid |

Her map için: floor/wall color, skyTop/Bottom, fog, özel prop'lar.
`config.size` ekle: `small/medium/large` → spawn ayarları.

### 2.2 Portal Mekaniği — `arena.js` + `game.js`

- Arena'da 2 portal (mavi/oranje halka)
- Top portala değince → diğer portaldan çıkış
- `arena.buildPortals()` → 2 halka + particle
- `ball.update()` içinde portal çarpışma kontrolü
- Her 30sn'de portal yer değiştirir (random)
- Top portalden çıkınca hız +20%

### 2.3 Extra Top Modelleri — `ball.js`

`BALL_SKINS` config:
| Skin | Görsel | Efekt |
|------|--------|-------|
| classic | Yıldız patern | — |
| fire | Alev particle | +5% hız |
| ice | Buz kristali | yavaşlatma efekti |
| lightning | Şimşek trail | — |
| bomb | Siyah küre | patlama特效 |
| star | Parlak yıldız | — |
| rainbow | HSL döngü | renk değişimi |

`ball.setSkin(skinId)` → mesh'i yeniden build.
Store'da `equippedBall` zaten var.

---

## Phase 3 — UI/Meta (DÜŞÜK ÖNCELİK)

### 3.1 Karakter Seçim Ekranı — `index.html` + `ui.js`

Main menu'den "Play" → Karakter seçim → Lobby.
- Karakter kartları grid (CSS)
- Stat göstergesi (HP/speed/deflect radar chart?)
- "Select" butonu → `store.set('selectedChar', id)`
- Skill seçimi (1 aktif) + 4 rune slot
- Loadout kaydet → `store.set('loadout', {char, skill, runes})`

### 3.2 Shop/Market — `index.html` + `store.js`

- Tablar: Characters / Balls / Runes / Cosmetics
- Coin ile satın alma (store.buy zaten var)
- Coin maç sonu kazanım (store.grant)
- Owned items check (store.owns zaten var)
- Preview 3D model (küçük canvas)

### 3.3 Battlepass — `store.js` + `ui.js`

- `store.data.battlepass` zaten var: `{tier, xp, claimed:[]}`
- 50 tier, her tier'da reward (coin/character/ball/rune)
- Maç sonu XP → tier dolum
- Battlepass track UI (scrollable)
- Free track + Premium track (opsiyonel)

### 3.4 Avatar Çizim — `index.html` + `js/avatar.js`

- Canvas tabanlı basit paint (16x16 veya 32x32 grid)
- Renk paleti + brush + fill + erase
- `store.set('customAvatar', dataURL)`
- Skorbord'da avatar göster (small img)
- Store'da `customAvatar` zaten var

### 3.5 Practice Range — `game.js` + `ui.js`

- "Practice" modu: bot yok, sınırsız top
- Top spawnlama: R tuşu → top spawn
- Top taşıma: F tuşu → top'u önüne koy
- Hedef mankenleri (sabit bot'lar)
- Skill cooldown'ları göster
- Damage sayacı

### 3.6 Party Play / Lobby Sistemi

- `network.js` zaten P2P host/join var
- Party: arkadaş kodu ile grup kur → birlikte lobby'ye gir
- Lobby'den ayrıl → `network.disconnect()`
- Ready check sistemi
- Host kick oyuncu

### 3.7 Aydinlik Skybox + Tema

- Mevcut space/neon map'ler karanlık → aydınlık palette
- Daha parlak ambient/hemisphere light
- Fog mesafesi artır
- Pastel renk paleti (TF2 vibe)

### 3.8 Profesyonel UI/CSS

- Steam-quality: daha temiz layout, animasyonlar
- Settings genişlet: FOV, keybinds, grafik kalitesi, crosshair stil
- HUD: damage meter, skill cooldown bar, kill feed
- Tab menu: CS tarzı oyuncu listesi
- Top bar: skor + timer + round

---

## Phase 4 — Espor + Eğlence (OPSIYONEL)

- Ranked mode (ELO)
- Replay system (mesajları kaydet)
- Spectator mode
- Tournament bracket
- Daily challenges
- Achievements
- Season pass
- Voice chat (WebRTC)
- Emoji/wheel quick chat

---

## Implementasyon Sırası (Ponytail)

1. **characters.js** — karakter statları (küçük dosya)
2. **skills.js** — skill/rune tanımları (küçük dosya)
3. **player.js extend** — applyLoadout, useSkill, stamina-based attack, consecutiveMisses
4. **bot.js extend** — karakter ata, skill kullan
5. **game.js extend** — handleHit damage ramp, portal, spam check
6. **arena.js extend** — yeni mapler, portal build, aydinlik skybox
7. **ball.js extend** — skin system, portal teleport
8. **store.js extend** — loadout, owned skills, battlepass tier'lar
9. **ui.js extend** — karakter select, shop, battlepass, avatar, damage meter
10. **index.html extend** — yeni screen'ler, lobby ban, settings genişlet
11. **style.css extend** — profesyonel tema, yeni UI bileşenleri

Her phase'de: en kısa diff, mevcut pattern'i takip et, ponytail comment bırak.

---

## Ponytail Notları

- Yeni framework yok — Three.js + vanilla JS devam
- Yeni dependency yok — peerjs zaten var
- Her skill/character tek dosyada, basit objeler
- Test: `__main__` self-check veya basit demo() (ponytail kuralı)
- `ponytail:` comment ile bilinçli kısaltmaları işaretle

## Dosya Yapısı

```
dodgb/
├── index.html          (UI screen'leri)
├── css/style.css       (tema)
├── js/
│   ├── main.js         (bootstrap)
│   ├── game.js         (oyun mantığı)
│   ├── player.js       (FPS controller + stats)
│   ├── bot.js          (AI)
│   ├── ball.js         (top fizik)
│   ├── arena.js        (map'ler)
│   ├── renderer.js     (Three.js)
│   ├── ui.js           (HUD/menü)
│   ├── network.js      (P2P)
│   ├── scoreboard.js   (skor)
│   ├── audio.js        (SFX)
│   ├── store.js        (meta progression)
│   ├── characters.js   (YENİ - karakter statları)
│   ├── skills.js       (YENİ - skill/rune tanımları)
│   ├── avatar.js       (YENİ - avatar çizim)
│   └── shaders/
```
