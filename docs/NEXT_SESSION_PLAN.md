# NEXT SESSION PLAN — 5 saatlik limit yenilenince

> Oluşturuldu: 2026-07-28. Kaynak: kullanıcıyla oturum sohbeti.
> Sıra önemli değil ama numaralandırma öncelik önerisi. Her madde bağımsız
> agent'a delege edilebilir (dosya çakışması notlarına dikkat).

---

## 0. Devam eden / önceki turdan miras kalan işler

- [ ] **Bıçak viewmodel fix** — arka planda bir agent (`a187d874e04dd0064`) çalışıyordu,
      bu oturumun sonunda tamamlanmamış olabilir. İlk iş: durumunu kontrol et
      (`SendMessage` ile devam ettir veya sonucunu oku), test et, commit et.
- [ ] **`tests/server-registry.test.mjs`** — `normalizeLobbyRecord is not a function`.
      Kullanıcının son yüklemesinden (V27-07-2026) önce de kırıktı, hiç dokunulmadı.
- [ ] **Siluet target-outline** — `renderer.createTargetOutline` rig göçünde silinmiş,
      hedef göstergesi şu an düz kutu. `renderer.js`'e API'yi geri koy, `bot.js`/`game.js`
      zaten `this.renderer.createTargetOutline(parts)` çağrısı bekliyor
      (bkz. `tests/target-outline.test.mjs` — bu turda ölü test olarak SİLİNDİ, geri
      eklenecek özellik tamamlanınca test de geri yazılmalı).
- [ ] **CRLF/LF tutarsızlığı** — repo bazı dosyalarda CRLF bazılarında LF karışık.
      Bu yüzden bugün 40k satırlık sahte merge çakışması çıktı, iptal edilmek zorunda
      kalındı. Tek seferlik `.gitattributes` + normalize commit'i gerekiyor.
      **ÖNEMLİ**: bunu SADECE başka paralel agent/oturum çalışmıyorken yap — aksi halde
      her paralel diff yine şişer.

---

## 1. Mekanik

- [ ] **Kill-confirm mikro ödülü** — bir oyuncuyu öldürdükten sonra kısa süre
      (örn. 3-4sn) elindeki top "yanıyor" — bir sonraki atışta küçük hasar bonusu.
      `js/game.js` kill event'inin olduğu yere (`_killStreaks` civarı) hook.
- [ ] **Combo tabanlı ability şarjı** — art arda deflect (perfect-deflect zaten var,
      `js/perfect-deflect.js`) skill cooldown'unu azaltsın. `js/skills.js` cooldown
      tick sistemine bağlanabilir.
- [ ] **Goal Rush "power shot"** — kaleye 8m'den az mesafeden atılan gol 2 puan sayar.
      `js/goal-mode.js` (bu turda eklendi) pure fonksiyonlarına mesafe kontrolü eklenir,
      zaten `checkGoalEntry` içinde top pozisyonu var.

## 2. Harita / Mod

- [ ] **Ice Map** — kaygan zemin (`js/arena.js` MAPS + `js/player.js` sürtünme).
      MIMO.md Phase 2 #10, hâlâ başlanmadı.
- [ ] **Cloud Map** — düşük yerçekimi. MIMO.md Phase 2 #11.
- [ ] **Jungle Map** — su tehlikesi. MIMO.md Phase 2 #12.
- [ ] **Goal Rush özel harita** — dar-uzun "saha" hissi, mevcut kale-oransal-türetme
      sistemiyle (`computeGoalZones`) otomatik uyumlu olacak.

## 3. Kozmetik / Görsel

- [ ] Bıçak viewmodel fix (bkz. §0, bu turda başladı).
- [ ] **Finisher cosmetic tetikleyici eksik olabilir** — `js/cosmetic-models.js`
      `spawnFinisherCosmetic` fonksiyonu bu turda eklendi ama kill-cam/elimination
      anında gerçekten çağrılıp çağrılmadığı DOĞRULANMADI. Önce kontrol et, sonra
      gerekiyorsa `js/game.js` ölüm/kill event'ine bağla.
- [ ] Siluet target-outline geri getirme (bkz. §0).

## 4. Progression

- [ ] **Battlepass günlük XP bonusu** — Challenges ekranı (`js/daily.js`) zaten var,
      3 günlük challenge tamamlanınca battlepass'e (`js/battlepass.js`, bu turda
      eklendi) bonus XP eklenmeli. Şu an iki sistem birbirinden bağımsız.

## 4.5. Site Geneli Design/Animasyon Yenileme

Mevcut durum: `js/juice.js` in-game hit-stop/shake/slow-mo/combo zaten var, case-açma
reveal'ı var (`js/main.js`/`js/ui.js`), CSS'te 54 transition/keyframe kuralı var —
ama hepsi DAĞINIK, tek bir "motion language" altında birleşmiyor. Bu turda eklenen
`--ui-motion-fast/base/slow` + `--ui-ease` tokenları (`css/ui-tokens.css`) var ama
site genelinde kullanılmıyor henüz. Hedef: oyunu "bir kere daha oynayayım" hissi
veren tutarlı, canlı bir ürün gibi hissettirmek — kalıcı, tekrar oynatan bir tasarım.

- [ ] **Motion language birleştirme** — tüm ekranlardaki geçişler (menu→shop,
      lobby→match, modal aç/kapa) aynı `--ui-motion-*`/`--ui-ease` tokenlarını
      kullansın. Şu an her ekranın kendi ad-hoc timing'i var.
- [ ] **Menü hero'yu canlandır** — showcase avatar zaten Three.js ile canlı
      (`js/shop-showcase.js`), ana menüde de benzer bir arkaplan sahnesi/parallax
      düşünülebilir (idle karakter, hafif kamera driftı, reduced-motion'da durur).
- [ ] **Maç-sonrası "bir tur daha" ekranı** — şu an match sonucu + stats var
      (`js/matchhistory.js`) ama battlepass ilerlemesi/yakın ödül/streak sayacı
      aynı ekranda GÖRÜNMÜYOR. Post-match özet ekranına "sıradaki ödüle N XP kaldı"
      gibi somut bir sonraki-adım göstergesi eklenmesi güçlü bir "tekrar oyna" kancası
      (manipülatif dark pattern değil — gerçek ilerleme göstergesi).
    - `js/battlepass.js` zaten `xpForTier`/tier progress export ediyor, direkt bağlanabilir.
- [ ] **Case/kutu açma reveal'ını güçlendir** — mevcut reveal akışını (`js/cosmetics.js`
      weighted roll + `js/main.js`/`js/ui.js` reveal UI) suspense/rarity-tier'a göre
      farklılaştır: legendary çıkışında ekstra flaş/ses/yavaşlama (zaten `js/juice.js`
      slow-mo var, case açma bunu ödünç alabilir), rare/common'da kısa ve hızlı.
- [ ] **Loading ekranı** — şu an statik "Loading assets..." (`css/style.css:69`), map
      preview'ı zaten var (`match-loading-map`) ama görsel olarak sade. Map'e özel
      arkaplan gradyanı/ikon + ilerleme çubuğuna micro-interaction eklenebilir.
- [ ] **HUD juice'ü genişlet** — hit/kill/deflect anlarında `js/juice.js` zaten
      shake/hitstop veriyor; kill feed, combo display, hasar sayıları için de aynı
      juice sistemine kanca atılabilir (şu an bazıları statik CSS animasyonu,
      bazıları juice sistemi — tutarsız).
- [ ] **Ses-animasyon eşleşmesi** — `js/audio.js` zaten SFX yönetiyor, yeni
      animasyonlar eklenirken karşılık gelen ses de eşleştirilmeli (sessiz görsel
      efekt boşluk gibi hissettirir).
- [ ] **Reduced-motion disiplini** — yukarıdakilerin HEPSİ `prefers-reduced-motion`
      / mevcut `.reduce-motion` killswitch'ine bağlanmalı (bu turdaki CSS agent'ı
      bunu zaten doğru yaptı, aynı disiplin korunmalı).

**Not**: bu madde geniş kapsamlı — muhtemelen 2-3 ayrı agent'a bölünmeli
(motion-token birleştirme / post-match ekranı / case-reveal+loading). Tek agent'a
"hepsini yap" demek kalitesiz, yarım iş riski taşır.

## 5. warball.io Yayın (daha önce planlanmış, hâlâ bekliyor)

Detaylar `docs/WARBALL_IO_PLAN.md` §4'te:
- TURN sunucusu + PeerJS self-host (kısmen yapıldı: `/api/rtc-config`, `docs/DEPLOY.md`
  hâlâ yazılmadı)
- Three.js CDN → yerel vendor kopyası (sürüm kilidi, CDN kesintisine karşı)
- Domain + HTTPS
- `data/*.json` → SQLite

---

## Delegasyon notları

- Dosya sahipliğini net ayır, paralel agent'lar aynı dosyaya yazmasın (bu oturumda
  4 agent paralel çalıştı, sıfır çakışma — aynı disiplinle devam).
- Her agent: `node scripts/check-js.js` + `npm test` ile bitirsin, sonucu verbatim
  raporlasın.
- Fizik/homing dosyasına (`js/ball.js` steering/homing kısmı) DOKUNULMASIN —
  bu turda 2 kere bozulup düzeltildi.
- Görsel/CSS agent'ları bu sandbox'ta canlı ekran görüntüsü alamıyor
  (`document.hidden=true`, rAF donuk) — offscreen manual `renderer.render()` +
  `toDataURL()` PNG trick'i kullanılmalı (bu turda karakter rig ve bıçak
  doğrulamasında işe yaradı).
