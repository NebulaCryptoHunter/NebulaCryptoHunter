# NEBULA — Audit Dimensi Ikon & Touch Target
**Tanggal:** 1 November 2026  
**Cakupan:** `index.html` Hunter HD frontend / desktop, tablet, mobile  
**Status:** Source-based design audit; browser screenshot/real-device interaction not yet independently validated.

## Defects confirmed in source

| Category | Existing dimensions prior to audit | Resolution / intended computed dimensions |
|---|---|---|
| 12 upstream provider LEDs | 4–5px dots | 8×8px all breakpoints |
| Provider chips | 19px at phone low-height; 22–34px elsewhere | 36px desktop/mobile; 38px tablet |
| Action controls SCAN/SINKRON/AUTO/HIST/WATCH/EXP/AUDIT/DBG | 27–44px tall, most <40px on mobile | 40px nominal; 38px on <=640px-height constrained viewports |
| Two mode/risk selectors | 27–44px | 40px desktop; 38px phone, 36px short screen |
| KPI symbols (DATABASE/PREDICTION/UNIQUE) | 18.4px desktop and **hidden on mobile** | 26×26px desktop, 18×18px phone (16×16px short viewport) |
| AI / RADAR / HISTORY heading symbols | ~19.2px glyph without fixed icon frame | 26×26px frame desktop; 22×22px phone |
| Token score circle | 36×36px | 44×44px desktop, 42×42px phone |
| Score numeral (inline 0.55rem) | ≈8.8px | 11px |
| Token action buttons (WATCH/CA/PH/PUMP/DEX/LIHAT PASAR) | 30–36px | 40px minimum; 3 columns × 2 rows on phone |
| Badges, wallet status, OB/FVG, cache | ~5.6–8.3px text; OB/FVG **hidden below 360px** | 10px text, 18px min-height; badges wrap; OB/FVG remain visible |
| Arrow scroll controls | 29–34px high | 40×40px normal; 38px low height |
| Mobile AI/RADAR/HISTORY tabs | 30–40px | 40px normal; 36px compact |
| Export, overlay close, archive pager | Could be under 30px | At least 42×42px clickable area |
| AI model validation gauge | Already constrained 80–126px in fixed HUD | Unchanged; remains proportional |
| Radar scope | Already constrained 67–140px across breakpoints | Unchanged; remains proportional |
| Hunter ship & orbital planet | Width-based; can crop aggressively into a 60–116px header | Aspect-preserving object-fit:contain with height-based cap |

## Responsive layout and expected geometry

**Desktop >=1200px:** all 12 provider chips on one row; eight action buttons on one row; KPI icons visible; token action buttons in six columns; separate token/history scroll areas.

**Tablet 768–1199px:** six provider chips per row; all action buttons visible; 38px provider controls, 40px actions.

**Phone 421–767px:** six provider chips per row, mobile control grid four per row; token action grid 3×2 and large score ring.

**Phone <=420px:** provider chip grid changes to four columns × three rows; prevents long labels such as COINGECKO from colliding with LED dots; all 12 statuses retained.

**Short viewport height <=640px:** constrained 36–38px targets on primary navigation preserve dashboard room. No controls intentionally hidden; radar and history remain independently scrollable.

## Invariants / safeguard

- No JavaScript/application logic changed by this PR.
- D1 data and server scoring logic untouched.
- SCAN, SINKRON, AUTO, HIST, WATCH, EXP, AUDIT, DBG handler IDs retained.
- All 12 upstream provider indicators retained.
- The four original HD WebP image paths retained, no regenerated artwork.
- AI model gauge and radar animation remain interactive/visual as before.
- All token badges remain available: restored/unverified, confidence, wallet, cluster, OB, FVG, rug, cache, rank, multiplier.
- All controls remain keyboard-focusable. Contrast and actual screen clipping **require browser inspection**; CSS tests confirm source contract only.

## Verification

Run `node --test tests/*.test.mjs backend/tests/*.test.mjs` through repository CI. Check actual browser dimensions on 320×568, 390×844, 768×1024, 1366×768 and 1920×1080 after deployment. Browser zoom 100%, then 125%. If a very small viewport lacks enough space for content, do not hide any provider indicator or action; prefer scrolling individual data panels.
