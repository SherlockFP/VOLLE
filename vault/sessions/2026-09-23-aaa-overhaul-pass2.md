# 2026-09-23 — AAA overhaul, pass 2 (viewmodel, skins, spectating, perf)

Follows [[2026-09-23-aaa-overhaul-pass1]]. Owner direction: no downloaded asset packs —
everything procedural/synthesized; CS2-grade viewmodel feel is the top priority.

## Viewmodel (js/player.js, js/renderer.js, js/viewmodel-hand.js, js/knife-animation.js)
- Separate viewmodel pass: own scene + camera (FOV 60) rendered as a second composer
  RenderPass with cleared depth → no ballooning at FOV 110, no wall clipping, still bloomed
  and tone-mapped. Procedural studio PMREM environment so metal skins reflect.
- CS-style `viewmodel_fov`, `viewmodel_offset_x/y/z` console commands (persisted).
  Defaults tuned in-game: fov 60, x 1.2, y -0.4, z 0.8; whole hand+item scaled 0.82.
- New hand: tapered sleeve + gloved fist whose finger arcs wrap the handle; fist rides a
  wrist group that follows the item's animation. Glove = data (colors + pattern + finish +
  knuckles + glow), 10 procedural patterns × 5 finishes.
- Keyframed animation engine (Catmull-Rom tracks): draw, slash, stab, heavy, inspect
  (face-flip / edge-look alternate, 3.5% rare toss), idle breathing, R = twirl (queues one
  follow-up so spamming chains seamlessly). F = inspect.
- Karambit rebuilt as one crescent blade (was a detached torus + cone); karambit/talon
  rolled so the hook curves down/forward. New models: kukri, gut, huntsman, talon, flip.
- Synthesized knife foley (layered whoosh, unsheathe scrape + steel ring, butterfly clicks).

## Economy / content (catalog agent)
- 24 gloves, Glovebox + Blade Vault cases, 12 new knife skins; tiers C..S+ (js/tiers.js);
  Tier List shop tab with exact per-case odds (also the odds disclosure).
- Pity now treats exotic as premium (server + client).

## Spectating (spectator agent)
- Join as spectator (lobby + code, mid-match), POV or seated stands (C toggles), emotes
  from stands (host-relayed, 3/4 s), crowd, "N watching", cross-court rule (default OFF,
  lobby toggle, host-enforced, bots respect). Emote wheel: 5 bugs fixed (never networked,
  icons never cleaned up, Enter also opened chat, mouse turned camera/clicked knife,
  stayed open after death).

## Ball skins (ball agent)
- Procedural per-skin surface patterns (cached CanvasTexture LRU), legendary rim pulse,
  rarity/overdrive trail scaling, pooled skin-coloured impact bursts. Physics untouched.

## UI
- Settings: 2-column compact rows, no overlap, teal surface (stray warm background gone).
- Case reel: only the in-game Reduce Motion setting collapses it; OS preference keeps the
  spin but drops flash/confetti.

## Performance / shipping
- `npm run build` (esbuild devDependency only) → dist/ hashed, minified, code-split bundle;
  server serves dist/index.html when present (`VOLLE_DEV=1` forces dev), immutable caching.
- Brotli/gzip for text assets (server/compress.js, built-in zlib, content-hash cache).
- First-load JS: 132 requests / ~4.2 MB → 5 requests / ~0.53 MB (br). CSS 631 → 121 KB.
- Docker/Render/CI run the build (Docker installs dev deps for the build, then prunes).

## Validation
- `npm run check` 118 files OK; `npm test` 2091/2091. Browser: viewmodel (karambit,
  butterfly inspect), knife test drive, settings (desktop + 420 px), bundled boot.
- Not done: two-browser host+spectator soak; human feel test of animations.

## Next
- Netcode pass in flight (interpolation buffer, clock sync, binary codec, net_graph).
- Payment checkout, i18n, mobile controls, menu hero art, real leaderboard.

## Pass 3 additions (same day)
- Netcode: snapshot interpolation on sender clock with adaptive jitter delay, bounded
  extrapolation, faded corrections (js/net-interp.js); clock sync (js/net-clock.js);
  capability-negotiated binary codec (js/net-codec.js, legacy peers keep JSON); ball
  prediction + reconciliation; spectator fan-out batched; initPeer 20 s timeout;
  `net_graph 1`. Player pos 84 B → 24–30 B; ball ~7.7 → ~1.2 KB/s; spectator relay
  ~31 → ~3.4 KB/s; remote max frame jump 5.8× → 1.05×.
- Real 3D item thumbnails everywhere (js/item-thumbnails.js) + CS2-style 3D case reveal
  (js/case-reveal-3d.js), slowing reel ticks + reveal sting.
- Maps: Neon Rooftop, Sunken Temple, Orbital Station (js/map-art/*), 8 maps polished,
  draw calls down on every map; new maps registered in js/sports.js.
- MVP post-match card with the MVP's knife/gloves/ball on a turntable (js/mvp-*.js),
  level-up flash.
- Menu hero now actually shows the equipped knife (old code read a missing key and the
  wrong object path). Hero pose still keeps it low by the leg — a "show off" pose is next.
- Validation: 2179/2179 tests, 129 files syntax-clean, production build OK.
