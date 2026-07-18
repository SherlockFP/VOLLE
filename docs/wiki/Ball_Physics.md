**Özet:** Top fiziği, deflect mekaniği, spawn, homing, collision, skin sistemi.
**Kütüphaneler/Teknolojiler:** Three.js Vector3, lerp
**Bağlantılar:** [[DODGBALL]], [[Ball_Skins]], [[Arena_System]]

## Fizik
- Gravity: -14 (düşüş)
- Base speed: 11, max: base * 3.0 (~33)
- Speed ramp: her deflect **%5** hız artışı
- **Speed sabittir**: Sadece yön steer edilir, magnitude kilitli (`_clampSpeed`). Drift/yavaslama yok.
- Source Engine tarzı wall bounce (angle preserves speed)
- Floor bounce: speed-dependent bounce height

## Deflect
- `deflectWithAim()`: **%100 player aim**, no auto-aim
- Flick classification: vertical > 25 → spike (-y), < -25 → lob (+y)
- Flick power bonus: +%15 speed per power

## Ball States — Yön Steering Modeli
Top **rakibe doğru çekilir** (homing) ama **aim yönü ivmeyle yön değiştirir**.
Sadece yön steer edilir, hız sabit kalır → dengesiz hız yok.

- **homing**: `desired = targetDir.lerp(velDir, aimW)`, aimW = min(dist/18,1)*0.4
  - Steer rate: `min(3.0*dt, 1)` — yumuşak dönüş
  - Hedefe çekilir, aim/momentum yönü büker
- **rally**: `desired = targetDir.lerp(velDir, aimW)`, aimW = min(dist/20,1)*0.45
  - Steer rate: `min(2.5*dt, 1)`
  - Uzakta aim daha etkili, yakında homing baskın
  - Top seker (wall/floor bounce) ama sonra tekrar rakibe çekilir

## Hedef Noktası (Whole Body)
- `_getTargetPos()`: Artık **gövde merkezini** hedefler (eye level - 0.6, min 0.8)
- Rastgele bodyZone (head/chest/abdomen/legs) homing hedefini etkilemez
- Body zone sadece hasar hesabında kullanılır

## _clampSpeed
- `velocity.multiplyScalar(currentSpeed / velocity.length())`
- Her frame sonunda hızı currentSpeed'e sabitler → gravity/spin oynatmasın

## Ceiling Guard
- `ceilingHeight <= 0` olan haritalarda (openAir) ceiling collision atlanır

## Ricochet
- %20 ihtimalle top duvara veya yere vurup seker

## Collision
- `arena.collidables` array: her collidable prop {mesh, pos, radius}
- Ball + Player cylinder collision check

## Trail
- Sphere dots with speed-dependent size/life
