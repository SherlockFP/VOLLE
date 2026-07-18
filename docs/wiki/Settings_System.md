**Özet:** Oyun ayarları — unified settings modal, anında uygulanan değişiklikler.
**Kütüphaneler/Teknolojiler:** HTML select/range/color, localStorage
**Bağlantılar:** [[CSGO_Lobby]], [[DODGBALL]]

## Ayarlar Listesi
| Ayar | Tip | Etki |
|------|-----|------|
| Sensitivity | range 1-10 | Player.sensitivity = value/1000 |
| Volume | range 0-100 | Audio volume |
| FOV | range 60-110 | Camera.fov |
| Resolution | dropdown | Renderer.setSize(w,h), camera.aspect |
| VSync | on/off | localStorage flag |
| FPS Limit | 0/30/60/120/144/240 | localStorage flag |
| Bot Difficulty | easy/medium/hard | Bot reaction time, deflect chance |
| Match Time | 3/5/10 min | Scoreboard time limit |
| Max Rounds | 5/10/20 | Scoreboard round limit |
| Graphics Quality | low/medium/high | localStorage flag |
| Crosshair Style | cross/dot/circle | crosshair DOM rebuild |
| Crosshair Color | color picker (#00ff88) | CSS color |
| Crosshair Size | range 6-30 | crosshair line length |
| Crosshair Gap | range 2-24 | gap from center |
| Crosshair Thickness | range 1-6 | line width |
| Crosshair Dot | toggle | center dot on/off |

## Resolution Fix
- Önceden window resize custom resolution'ı eziyordu
- `_customRes` flag ile çözüldü: resize'de stored resolution korunur
- Renderer'daki resize listener kaldırıldı, main.js kontrol ediyor

## Crosshair (Yeni)
- 3 style: cross (4 line), dot (circle), circle (ring + optional dot)
- Dynamic rebuild: `applyCrosshair()` tüm elementleri silip yeniden oluşturur
- CSS: `position: fixed; width:100%; height:100%` — kamera hareketinde kaymaz

## Özellikler
- Unified settings modal (oyun içinde de aynı panel)
- Resolution anında renderer'a uygulanır, resize'de korunur
- Tüm ayarlar Store (localStorage) ile persist edilir
- Crosshair ayarları her değişiklikte anında rebuild
