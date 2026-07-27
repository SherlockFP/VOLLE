# WARBALL.IO — Master Plan

> Owner: Opus (planlama, inceleme, karar). Implementation: Sonnet subagent'lar.
> Son güncelleme: 2026-07-27
> Karar: netcode **P2P + TURN** (dedicated'a taşınabilir kalacak), karakterler **prosedürel rig + iskelet animasyon**, öncelik **modeller + kozmetik**.

---

## 0. Mevcut Durum (denetlendi)

| Alan | Durum | Not |
|---|---|---|
| Kod | ~37k satır JS, 68 modül | ES modules, bundler yok |
| Three.js | CDN 0.170.0 importmap | `models/` klasörü **boş** — her şey prosedürel |
| Karakter mesh | `js/bot.js:_buildBoxMesh` düz Group | Kol/bacak **merkezden** döner (pivot yanlış), animasyon yok |
| İkinci mesh | `js/shop-showcase.js:createShowcaseAvatar` | Ayrı, statik, sadece vitrin |
| Kozmetik | `js/cosmetic-catalog.js` 5 tip / 30 item | cape, pet, shoes, aura, impact |
| Skin | `js/avatar.js` 22 skin | classic/slim, 4 renk kanalı |
| Netcode | PeerJS P2P, public broker | TURN yok, host authority |
| Sunucu | `server.js` sıfır-bağımlılık statik + JSON store | `data/profiles.json` |
| Test | `npm test`, 57 test dosyası | node --test, jsdom yok |

**Ana bulgular:**
1. İki ayrı karakter mesh kodu var → tek kanonik rig'e birleşmeli.
2. Eklem pivotları yanlış (kol omuzdan değil ortadan dönüyor) → animasyon inandırıcı olmuyor.
3. Kozmetikler mesh'e **socket** üzerinden bağlanmıyor → yeni tip eklemek her seferinde elle konumlandırma.
4. Kozmetik tip sayısı .io ekonomisi için az (5 tip). Hedef: 12 tip.

---

## 1. Mimari — Karakter Sistemi

Katmanlar (aşağıdan yukarı, her katman üstünü tanımaz):

```
character-pose.js   saf matematik, THREE yok, node-testable   [✅ TAMAM]
character-rig.js    THREE iskelet + socket + materyal          [Aşama A]
character-anim.js   oyun olayları → pose controller köprüsü    [Aşama A]
cosmetic-catalog.js item tanımları (veri)                      [Aşama B]
cosmetic-models.js  socket'e takılan mesh üreticileri          [Aşama B]
bot.js / player.js / shop-showcase.js  tüketiciler             [Aşama C]
```

### 1.1 `js/character-pose.js` — TAMAMLANDI
Saf poz matematiği. Dışa açtığı API:
- `JOINTS`, `POSE_STATES`, `ONE_SHOT_STATES`, `STATE_DURATION`
- `neutralPose()`, `poseFor(state, time, params)`, `blendPose(a, b, t)`
- `locomotionState({speed, grounded, verticalSpeed, alive})`
- `createAnimatorState(seed)`, `stepAnimator(controller, dt, facts)`, `triggerAction(controller, action)`
- `resolvePose(controller, facts)`

Poz durumları: `idle walk run jump fall land throw deflect hit dead emote victory`.
Poz objesi şekli: `{ offsetY, lean, hips|torso|head|shoulderL|elbowL|shoulderR|elbowR|hipL|kneeL|hipR|kneeR: {x,y,z} }`.

### 1.2 `js/character-rig.js` — SÖZLEŞME (Aşama A)

```js
export const RIG_SOCKETS = ['head','face','back','chest','waist','handL','handR','footL','footR','aura','trail'];
export function createCharacterRig(options) → RigHandle
```

`options`: `{ characterId='rally', skinId='default', team='red', materialFactory=null, outlineFactory=null, quality='high', castShadow=true }`
- `materialFactory(colorHex)` verilirse toon materyal için kullanılır (bot.js `renderer.createToonMaterial`), yoksa `MeshStandardMaterial`.

`RigHandle`:
| Üye | Tip | Açıklama |
|---|---|---|
| `root` | `THREE.Group` | Ayak hizası y=0, ileri yön -Z |
| `joints` | `Record<jointName, THREE.Object3D>` | `character-pose.js` JOINTS ile **birebir** aynı isimler |
| `sockets` | `Record<socketName, THREE.Object3D>` | Kozmetik takma noktaları |
| `applyPose(pose)` | fn | Poz objesini eklemlere yazar; `offsetY` → `root.position.y`, `lean` → `hips.rotation.z` |
| `setSkin(skinId)` | fn | Palet + slim/classic kol genişliği |
| `setCharacter(characterId)` | fn | Gövde oranları |
| `setTeam(team)` | fn | Takım renkli materyalleri günceller |
| `setVisible(bool)` | fn | |
| `dispose()` | fn | Tüm geometry+material dispose, root detach |
| `state` | getter | `{characterId, skinId, team}` donmuş kopya |

**Zorunlu iskelet hiyerarşisi** (pivotlar eklem noktasında, mesh'ler pivotun altında offsetli):
```
root(y=0)
└ hips (y=0.94)
  ├ torso (0,0,0) → mesh gövde y=+0.34, mesh boyun (neck-mesh) y=+0.74
  │ ├ head (y=0.80) → mesh kafa y=+0.20, socket:head y=+0.42, socket:face z=-0.24
  │ ├ shoulderL (x=-0.44, y=0.60) → mesh üst kol y=-0.24
  │ │ └ elbowL (y=-0.46) → mesh ön kol y=-0.22, socket:handL y=-0.46
  │ ├ shoulderR (x=+0.44, y=0.60) → aynısı ayna
  │ ├ socket:back (z=+0.24, y=0.34), socket:chest (z=-0.26, y=0.36)
  ├ hipL (x=-0.19) → mesh uyluk (genişlik .20) y=-0.26
  │ └ kneeL (y=-0.48) → mesh baldır (genişlik .18) y=-0.22, socket:footL y=-0.46
  ├ hipR ayna
  └ socket:waist (y=0.02)
root altında: socket:aura (y=0.9), socket:trail (y=0.1)
```
`neck-mesh` torso'ya bağlı (head'e değil) — böylece `aim`/idle sırasında kafa eğilirken
(±~0.8 rad'a kadar) boyun omuzdan kopup boşluk açmıyor; her iki komşusuyla (.02) taşarak
biner, hiç boşluk bırakmıyor.

Toplam boy **2.14** (y=0 taban .. kafa tepesi 2.14), 1.95 hedefi değil — bkz. not aşağıda.
`characterId` oranları `shop-showcase.js:CHARACTER_SHAPES` içinden **import edilerek** kullanılır (kopyalama yok).

> **2026-07-27 not (ponytail):** Bu bölüm önceden ~1.95 hedefliyordu; ölçüm 2.16 çıktı (taban
> -0.02, kafa boşlukla 1.74-2.14). Taban sızıntısı (calf offset -.24→-.22) ve kafa-gövde
> boşluğu (neck-mesh eklendi) düzeltildi → taban tam 0.00, toplam **2.14**. Kafayı küçültüp
> 1.95'e zorlamadım: `js/cosmetic-models.js` (dokunulmaz dosya) `createHat`/`createMask`
> içinde kafa üstü/vizör mutlak Y (ör. hat tepe süsü y=2.16, vizör y=1.7-2.02) **mevcut kafa
> geometrisine göre** hardcode'lu — kafayı küçültmek şapka/maske kozmetiklerini havada
> bıraktırırdı, socket taşınsa bile (`attachToRig` her zaman kozmetiği kendi mutlak yazarlı
> konumuna geri hizalıyor, bkz. `socketLocalOffset`). `js/player.js`'teki göz/kapsül yüksekliği
> (`this.height = 1.7`) ile çapraz kontrol: 1.7/2.14 ≈ 0.79 — iri-kafa/bloklu stile göre makul
> (bkz. `shop-showcase.js` referans modelinin kafa/boy oranı ~0.24, bizimkinden bile büyük).
> Üçüncü şahıs modeliyle birinci şahıs kamerası zaten 1:1 hizalı değil (endüstri normu); bu
> oranı zorlamak kozmetik hizalamasını bozmaya değmez.

Materyal slotları: `head, body, arms, legs, accent, detail, visor`. Palet `getShowcaseMaterialPalette()` ile alınır (kopyalama yok).

### 1.3 `js/character-anim.js` — SÖZLEŞME (Aşama A)

```js
export function createCharacterAnimator(rig, options) → AnimatorHandle
```
- `update(dt, facts)` — `facts`: `{speed, grounded, verticalSpeed, alive, aim, strafe}`; içeride `stepAnimator` + `resolvePose` + `rig.applyPose`.
- `play(action)` — `'throw'|'deflect'|'hit'|'land'`.
- `setLoop(state)` — `'emote'|'victory'|null` (locomotion'ı override eder).
- `controller` getter — mevcut controller state (replay/net senkron için serileştirilebilir).

**Hiçbir THREE animasyon sınıfı kullanılmaz** (AnimationMixer yok) — poz doğrudan yazılır, 0 alloc/frame hedefi.

---

## 2. Aşama B — Kozmetik Genişletme

Yeni tipler (mevcut 5 + 7 = 12), hepsi socket'e takılır:

| Tip | Socket | Adet | Not |
|---|---|---|---|
| hat | head | 8 | şapka/kask/taç |
| mask | face | 6 | maske/gözlük/vizör |
| wings | back | 6 | kanat, `applyPose` ile flap |
| backpack | back | 5 | sırt çantası/jetpack |
| banner | back | 4 | bayrak direği |
| trail | trail | 6 | koşu izi |
| finisher | — | 5 | eliminasyon efekti (mevcut `impact` ile aynı motor) |

Mevcut tipler korunur: cape, pet, shoes, aura, impact.
`cosmetic-catalog.js` şeması **değişmez** (`item(id,type,name,price,rarity,colors,style,description)`), sadece `COSMETIC_TYPES` ve `COSMETICS` genişler + `DEFAULT_WEARABLE_LOADOUT` yeni tipleri null ile alır.
`normalizeWearableLoadout` yeni tipleri otomatik kapsamalı (tipler tablodan türetiliyorsa değişiklik gerekmez — doğrula).

---

## 3. Aşama C — Entegrasyon

1. `bot.js:_buildBoxMesh` → `createCharacterRig` + `createCharacterAnimator`. `setTeam` rig'e devredilir. İsim/avatar sprite'ları korunur.
2. `player.js` 3. şahıs görünümü / ölüm kamerası aynı rig'i kullanır.
3. `shop-showcase.js:createShowcaseAvatar` → rig'i sarar, `setPoseTime` yerine animator idle.
4. `social-lobby.js` diğer oyuncular → rig.
5. Ağ: kozmetik loadout zaten `network.js` üzerinden gidiyor; **animasyon durumu ağdan gitmez** — `locomotionState` alıcı tarafta pozisyon farkından türetilir (bant genişliği 0).

---

## 4. Aşama D — warball.io Yayın (sonraki tur)

1. TURN sunucusu (coturn veya Metered/Twilio) + PeerJS self-host broker.
2. `index.html` 106KB → şablon parçalama + minify; CDN yerine yerel three.js kopyası (sürüm kilidi).
3. Domain + HTTPS (Caddy/Cloudflare), Dockerfile mevcut.
4. `data/*.json` → SQLite (çok-örnekli güvenlik) veya tek örnek + yedek.
5. Oran sınırlama zaten `server/request-limiter.js` içinde — TURN kimlik uçları eklenmeli.
6. Anti-cheat: host-authority olduğu için sunucu tarafı maç makbuzu (`server/match-receipt.js`) doğrulaması zorunlu tutulmalı.

---

## 5. Kalite Kapıları (her aşama sonunda)

```
npm run check      # tüm JS söz dizimi
npm test           # tüm node testleri
```
Yeni test dosyaları: `tests/character-pose.test.mjs`, `tests/character-rig.test.mjs` (THREE stub'lı), `tests/cosmetic-catalog.test.mjs` (mevcut, genişletilecek).

---

## 6. Delegasyon Kuralları (subagent'lar için)

- **Ponytail**: en kısa çalışan diff. Var olanı yeniden yazma, import et.
- Yeni bağımlılık **yok**. Three.js + vanilla JS.
- Dosya stili: 4 boşluk girinti, ES modules, `// ponytail:` yorumlarıyla kasıtlı sadeleştirmeler.
- Her modül `export` ettiği her şeyi test edilebilir tutmalı (THREE gerektiren kısımlar ayrı).
- Bitirince `npm run check` çalıştır ve sonucu bildir.
