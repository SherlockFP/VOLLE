**Özet:** 18 harita sistemi, her harita özel config, çarpışma, portal mekaniği, açık harita ortamları.
**Kütüphaneler/Teknolojiler:** Three.js, ShaderMaterial (skybox gradient), PointsMaterial (starfield)
**Bağlantılar:** [[DODGBALL]], [[Ball_Physics]]

## Haritalar
| ID | İsim | Boyut | Özellik |
|----|------|-------|---------|
| beach | Beach Arena | medium | Ocean, palm trees, glass walls |
| beach_open | Beach VB | small | Open air, ropes, no walls |
| industrial | Factory | medium | Glass walls |
| space | Space Station | large | Low gravity, starfield, planets, nebulae, asteroids, portals |
| neon | Neon City | medium | Neon billboards, portal, skyline buildings |
| dojo | Dojo | medium | Wooden lanterns |
| colosseum | Colosseum | large | Stone columns, open air, openSides |
| volcano | Volcano | large | Lava floor, embers, lava fountain, openSides |
| ice | Ice Palace | medium | Slippery, icicles, ice crystals, openSides |
| cloud | Cloud Realm | large | Low gravity, puffy cloud floor, floating islands, openSides |
| jungle | Jungle | medium | Trees with collision |
| cyber | Cyber Grid | medium | Holo grids, openSides |
| canyon | Canyon | xl | Rock formations, cacti |
| pillar | Pillar Hall | large | Stone columns with collision (fixed: collidable Y→0) |
| lava | Lava Pit | medium | Lava, stone bridges, boulders |
| crystal | Crystal Cave | medium | Glowing crystals |
| mecha | Mecha Hangar | xxl | Giant mecha statues |
| minecraft | Minecraft | large | Blocky terrain, block trees, block house, pond |

## Açık Harita Ortamları (openSides)
- **Cloud Realm**: Puffy cloud floor (70 overlapping spheres), corner cloud pillars, distant floating clouds, under-glow
- **Space Station**: Starfield (2000 particle PointsMaterial), Mars/Earth/Saturn planets, sci-fi grid floor, nebulae (3 large transparent spheres), asteroids (dodecahedrons)
- **Neon City**: Dark box buildings outside court with wireframe edge overlays
- **Volcano**: Lava glow particles + lava fountain columns
- **Ice Palace**: Ice crystal formations (cone geometry, transparent blue)
- **Generic** (beach/colosseum/lava): Tree silhouettes + low hills outside court

## Minecraft (Yeni)
- Single-mesh floor layers (grass/dirt/stone) + grid lines for blocky look
- Big blocks (S=2.0) — chunkier feel, fewer draw calls
- Block trees with trunk + leaf cross
- Wooden house with plank walls + stone slab roof
- Pond

## Collision Sistemi
- Her haritanın collidable prop'ları `arena.collidables` dizisinde
- Ball + Player collision: cylinder check, push + reflect
- **Pillar Hall fix**: Collidable Y center 0'a çekildi (oyuncu yerdeyken çarpışsın)
- Şu objeler çarpışabilir:
  - Ağaç gövdeleri (jungle, beach)
  - Sütunlar (colosseum, pillar)
  - Mecha bacakları (mecha)
  - Kanyon kayaları (canyon)
  - Kristaller (crystal)
  - Lav köprüleri (lava)
  - Direkler (beach_open)
  - Köşe varilleri (tüm haritalar)

## Portal
- 2 adet torus halka, 30sn'de yer değiştirir
- Top portala girince diğerinden çıkar + hız bonusu %20
- 1.5s cooldown

## Harita Değişiklikleri
- Tüm haritaların courtWidth +8~14, courtLength +12~16 artırıldı (%20 büyüdü)
- Çoğu haritaya `openSides: true` eklendi (beach, space, neon, volcano, ice, cloud, cyber, colosseum, lava)
