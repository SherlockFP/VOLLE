# Warrball Project

## IMPORTANT: Read This First
Before working on this project, ALWAYS read `MIMO.md` — it contains the current state, completed features, pending features, and file structure. For older dev history, see `docs/wiki/2BALL_Development_Log.md`.

## Quick Reference
- **Game**: 2BALL — 3D First-Person Dodgeball (Three.js, vanilla JS)
- **Server**: `node server.js` on port 8000
- **Current State**: `MIMO.md` (updated 2026-08-12)
- **Dev Log**: `docs/wiki/2BALL_Development_Log.md`
- **Plan**: `PLAN.md` (19 tasks, 4 phases)
- **Graphify**: Run `/graphify` to update code analysis
- **Graft**: Run `npm run graft:check`; if stale, `npm run graft:build`.
  Use `npm run graft:map` or pinned `npx --yes @nanonets/graft@0.9.1 ask
  "<question>"` before broad cross-file work. `graft/` is a local ignored
  cache, not a runtime dependency; do not run machine-global `graft init` or a
  paid/deep build without explicit approval.

## Key Files
- `js/ball.js` — Ball physics, homing, momentum, skins
- `js/player.js` — Movement, sprint, dash, wall jump, stamina
- `js/game.js` — Game loop, states, combat, celebration, spectate
- `js/arena.js` — 18 maps, walls, ceiling, props
- `js/console.js` — Console commands with autocomplete
- `js/ui.js` — HUD, scoreboard, settings, damage numbers
- `js/gamemodes.js` — Game modes including FFA
- `js/skills.js` — Skills + runes system
- `js/scoreboard.js` — Score tracking (no negative scores)

## Engineering Rules (proje-yerel, subagent'lar dahil herkes için)

Distilled from Ultra Agent Framework (`Desktop/Ultimate AGENT/.agent/AGENTS.md` —
8055 satır tam okunup damıtıldı, 2026-07-28) + bu repoda kanıtlanmış pratikler.
Global CLAUDE.md'deki Caveman/Ponytail/Fable/RTK modları bu framework'ten türüyor
ama orada sadece isimleri vardı, tanımları yoktu — burada proje-yerel, subagent'ların
da otomatik göreceği tam hâli var. Enterprise-özel bölümler (DB migration, auth,
cloud/dağıtık sistemler) bilerek atlandı — bu repoda karşılığı yok, taşımak
framework'ün kendi YAGNI kuralını ihlal ederdi.

### Çatışma Sırası (Final Priority System — iki kural çelişirse bu kazanır)

`Güvenlik/yasallık` > `Doğruluk` > `Kullanıcı niyeti` > `Güvenilirlik` >
`Sürdürülebilirlik` > `Performans` > `Token/maliyet verimliliği` > `Hız` > `Zarafet`.

Örnek: "az token kullan" (RTK) ile "bu regresyon daha fazla araştırma gerektiriyor"
çatışırsa — araştırma kazanır. Token verimliliği hiçbir zaman yanlış implementasyon
veya eksik doğrulamayı meşrulaştırmaz.

### Çekirdek Döngü (karmaşık her görev için)

**Observe → Orient → Plan → Act → Verify → Reflect.** Observe'i atlama (varsayımdan
hareket etme), Verify'ı atlama ("muhtemelen çalışır" yetmez). Bitirmeden önce
kendine sor: *En basit çözüm bu mu? Bir şeyi bozabilir mi? Kök nedeni mi çözdüm?*

### Oyun Geliştirme Modu (bu repo için doğrudan geçerli)

Her değişiklikte kontrol et: **frame time, input latency, allocation (0/frame
hedefi), fizik maliyeti.** Ana render/update döngüsünde pahalı işlem yok, gereksiz
allocation yok, frame spike yok. Bu oturumda zaten uygulanan disiplin (rig
`applyPose`, animator `update` — hepsi in-place mutate, yeni obje yok).

### Somut Kurallar

1. **Minimal patch.** En küçük çalışan diff. Var olanı yeniden yazma, import et.
   3 benzer satır kötü bir soyutlamadan iyidir. Küçük güvenli değişiklik büyük
   "mükemmel" yeniden tasarımdan iyidir — yeniden tasarım gerçekten gerekmiyorsa.
2. **Kanıt > varsayım.** `node scripts/check-js.js` + `npm test` + (görsel
   değişiklikse) tarayıcıda gerçek render/ölçüm. Bir agent'ın kendi raporu
   doğrulama değildir, çapraz kontrol et. "Done" demeden önce: değişiklik + kanıt.
3. **Debug sırası:** Gözlemle → tekrarla → ölç → kök nedeni bul → düzelt → doğrula
   → regresyonu önle. Semptomu değil kök nedeni düzelt (bkz. bu projede homing
   regresyonu — yüzeysel fix değil, hangi commit'in hangi sabiti bozduğu bulundu).
   İlk görünen hata satırı çoğu zaman kökeni değildir.
4. **Yeni bağımlılık yok.** Three.js + vanilla JS + Node built-in. Sıfır-bağımlılık
   sunucu (`server.js`) kuralı bozulmaz.
5. **Paralel agent = dosya sahipliği ayrımı.** Birden fazla agent aynı anda
   çalışıyorsa her birine hangi dosyaları SAHİPLENDİĞİNİ ve hangilerine
   DOKUNMAYACAĞINI açıkça yaz. Aynı dosyaya iki agent yazması "kötü paralellik"
   örneğidir. Bu repoda 8 agent paralel çalıştı, disiplinle sıfır çakışma çıktı.
6. **Testler davranışı korur, uygulama detayını değil.** Yeni özellik = yeni test.
   Var olan testi zayıflatarak/silerek geçirme; kırıksa önce testin mi
   implementasyonun mu yanlış olduğuna karar ver.
7. **Fizik/homing'e (`js/ball.js` steering kısmı) rastgele dokunma.** Bu dosya
   bu projede 2 kere sebepsiz zayıflatılıp düzeltildi — değişiklik gerekiyorsa
   ölçülen önce/sonra sayılarını rapor et.
8. **Satır sonu:** repo CRLF/LF karışık, `.gitattributes` henüz yok — dosya
   düzenlerken mevcut satır sonunu bozma (agent edit araçları bazen tüm dosyayı
   LF'ye çeviriyor, `git diff -w` ile gerçek diff'i her zaman doğrula).
9. **Ele alınan görev dışını değiştirme.** İlgisiz modülü düzenleme, yakındaki
   kodu "temizleme", otomatik modernize etme. Kapsam görev sınırının içinde kalır.
10. **Model seçimi göreve göre.** Basit/sınırlı iş → ucuz model (Sonnet/Haiku).
    Mimari karar, derin debug, güvenlik → güçlü model (Opus). Sadece belirsizlik
    yüzünden yükseltme yapma — önce araştır.
