**Özet:** FPS oyuncu kontrolü, kamera, hareket, hand mesh, stamina, skill sistemi.
**Kütüphaneler/Teknolojiler:** Three.js Euler/Quaternion, Pointer Lock API
**Bağlantılar:** [[DODGBALL]], [[Ball_Physics]], [[Bot_AI]]

## Hareket
- WASD + Space jump
- Speed: 10 (base), chill ile %80 slow
- Bounds: arena.bounds.xz, radius 0.7 (hand clipping fix)

## Kamera
- Pointer Lock tabanlı
- Euler YXZ rotasyon
- Sensitivity: store'dan, slider ile ayarlanabilir
- FOV: 60-110, store'dan
- Kick: deflect sonrası kısa upward punch

## Hand Mesh (El)
- **Tek el:** sağ el sadece (sol el kaldırıldı)
- Arm pozisyon: (0.25, -0.2, -0.1) — clipping fix için yakın
- Swing anim: deflect sırasında arm rotation + position
- Bob: idle'da sinüs bob
- Depth test: normal (clipping fix radius 0.5→0.7)

## Stamina
- Max: 100, her deflect: -25
- Regen: 35/s, exhausted'da 14/s
- Exhaustion threshold: 15
- Scout pasifi: +%50 regen

## Skill Sistemi
- Q tuşu aktif skill
- Cooldown tick her frame
- Skill list: slow, haste, shield, teleport, burn, aoe, heal
- Her skill 8-28s arası cooldown (artırıldı)

## Combat
- Attack range: 2.6 (vuruş mesafesi)
- Hit range: 0.7 (isabet mesafesi)
- Look-at-ball check: dot < 0.3 → deflect blocked
- Body zone: random head/chest/abdomen/legs
- Damage: base 25, deflectPower *, rune resist, passive resist
