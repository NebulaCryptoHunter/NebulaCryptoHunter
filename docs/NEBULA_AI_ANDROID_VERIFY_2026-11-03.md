# AI Performance — Android viewport verification

Date: 3 November 2026 (WIB).

The earlier desktop audit left mobile rendering unverified. This follow-up uses the documented Cloudflare Browser Rendering snapshot API on the public HTTPS production page, with mobile/touch viewport settings. It does not use the blocked data-URL preview, a private browser session, login credentials or an Android device. These are Chromium viewport simulations, not tests on physical Android hardware.

## Finding and repair

At 360 × 640, the last two instrument cards ended at y=658.19 and their captions at y=650.44. Their bottom portion was below the viewport. At 360 × 740 and 390 × 844, all eight readings already fit.

The CSS correction applies only at widths up to 767 px and heights up to 700 px:

- Instrument minimum height: 68 → 62 px.
- Internal padding/gaps reduced, with the existing 10 px label/caption fonts retained.
- Label margins removed and the label/number vertically aligned.
- The four-row, two-column arrangement, 23 px caption allowance and all eight instruments remain.

No scoring algorithm, API budget, data definition, desktop layout or trading behavior changes.

## Pre-deployment render checks

The audit selects the existing AI tab, waits for actual research rows, provider indicators and loaded fonts, then reads the rendered bounding rectangles. It checks all eight cards, labels, values and captions, including zero and unavailable values. The temporary audit script runs only in the disposable rendering session; it is not added to the production app.

| Mobile viewport | Baseline | With corrected CSS |
| --- | --- | --- |
| 320 × 640 | Not captured | All eight cards end at or before y=634.19; captions at or before y=628.16 |
| 360 × 640 | Last row below the 640 px viewport | All eight cards end at or before y=634.19; captions at or before y=628.16 |
| 360 × 740 | All eight readings visible | Outside the compact-height rule |
| 390 × 844 | All eight readings visible | Outside the compact-height rule |

Card captions fit their rendered boxes, text remains 10 px on the tested narrow screens, and no horizontal document overflow was observed. Advanced telemetry, the system console and the server dock can still extend below the fold on short phones; this change fits the eight primary readings, not the entire application page.

39 relevant existing Android, instrument, rendering-contract and JavaScript checks pass. Live verification after deployment is recorded separately.

## References

- [Cloudflare snapshot API](https://developers.cloudflare.com/api/resources/browser_rendering/subresources/snapshot/)
- [Cloudflare Browser Run limits](https://developers.cloudflare.com/browser-run/limits/)
- [Chrome mobile emulation limitations](https://developer.chrome.com/docs/devtools/device-mode)
