# TEMPORARY post-trial Discovery roster evaluation — 6 Sep 2026

> **DO NOT MERGE / DO NOT CHERRY-PICK.** Sanitized read-only analytical summary. No credentials or raw provider payloads.

## Evidence boundary

- Analysis window: 2026-09-05T20:00:00Z through 2026-09-06T07:15:00Z.
- Open Lab `races.finished` index was exhaustively hydrated through `races.docs` before filtering.
- 319 finished Bike race documents were hydrated in the window.
- 58 `Trainer Series` / Trial-tag race documents involved at least one Core from the current 25-Core Discovery roster.
- 11 of the 25 rostered Cores appeared in those Trial-tag documents; the other 14 had no Trial-tag appearance in the accepted window, so they receive no new Esports/star evidence from this trial pull.
- Trial race documents expose entrants, distance/format, Blue and Yellow stars, but not authoritative finish positions or elapsed result times. Therefore Trial participation/star evidence and current telemetry/speed evidence are kept separate.
- Current telemetry was pulled for all 25 Cores at 1000/1200/1400/1600/1800/2000/2200 where available and compared with the Open Lab global benchmark average at the exact distance.
- `median vs global avg` below is percentage difference versus the benchmark average median-speed baseline; **it is not a population percentile**.
- Blue/Yellow are separate star assignments. A Core may receive both in one race, so Blue + Yellow may exceed Trial race count.

## Current 25-Core evaluation

| Core | Trial races / stars | Current preferred distance | n | Median speed m/s | Median vs global avg | Assessment | Comment |
|---|---:|---|---:|---:|---:|---|---|
| Frozen Blade | 3 · 0B/2Y | Unresolved; test 1200/1400 | 8 @1600 | 16.764 | -0.04% | CONTINUE | 1000 stars encouraging, but 1000 median is weak; 1600 is roughly global-average. |
| Frost Rocket | 3 · 1B/0Y | 1000 provisional | 4 @1000 | 17.585 | +1.01% | HIGH-POTENTIAL | 1000 improved strongly through the completed trial but is one observation short of n=5. Best 1000 speed is 17.981 m/s. |
| Cyber Overdrive | 5 · 5B/0Y | Unresolved; test 1000/1200/1400 | 14 @1600 | 16.743 | -0.17% | CONTINUE | Exceptional star signal at 1600 but median speed is below global average; do not call 1600 preferred. |
| Iron Dynamo | 5 · 0B/0Y | Unresolved; test 1800/2000/2200 | 13 @1600 | 16.745 | -0.16% | CONTINUE | 1600 median is slightly below global average. Trial raised best 1600 speed to 17.369 m/s, so top-end ceiling remains interesting. |
| Nervy Runner | 3 · 1B/0Y | **1000** | 11 @1000 | 17.573 | **+0.94%** | **STRONG** | Meaningful sample and remains well above global average after the trial. |
| Creeper | 4 · 2B/1Y | **2200** | 8 @2200 | 16.804 | **+0.68%** | STRONG/WATCH | Trial stars came at 1600, but 1600 median is -0.33%; speed evidence clearly points to 2200. |
| Final Flash | 6 · 0B/0Y | 1600 for now; test 1400 | 8 @1600 | 16.819 | +0.28% | CONTINUE | Trial used her at 2200: n=6, +0.20%, no stars. 2200 is not compelling; 1400 remains the important pedigree-aligned test. |
| Peak Crown | 6 · 3B/3Y | **2200** | 14 @2200 | 16.866 | **+1.05%** | **STRONG** | Best new Long result: strong 2200 speed survived six added Trial races and received heavy star support. |
| Drift Mirage | — | **1400** | 5 @1400 | 17.064 | **+1.50%** | **STRONG** | No Trial-tag appearance today; current 1400 telemetry remains one of the best roster signals. |
| Vivid Rebel | — | 1600 very provisional | 3 @1600 | 16.784 | +0.07% | WAIT | Too little evidence and currently near global average. |
| Lynx Mystic | — | 1600 provisional | 3 @1600 | 16.660 | -0.66% | LOW PRIORITY | Too little evidence and currently materially below global average. |
| Vapor Blade | — | 1600 very provisional | 3 @1600 | 16.761 | -0.06% | WAIT | Too little evidence and essentially global-average/slightly below. |
| First Light | — | 1600 | 9 @1600 | 16.852 | +0.48% | CONTINUE | Moderately positive 1600 signal; 2200 is also slightly positive. |
| Violet Jaguar | — | **1800** | 5 @1800 | 16.952 | **+1.24%** | HIGH-POTENTIAL | Strong 1800 signal at the minimum useful sample; much better than her deeper 1000 profile. |
| Livid Jaguar | — | **1600/2000 provisional** | 4 @2000 | 17.067 | **+2.13%** | HIGH-POTENTIAL | Exceptional small-sample 2000 signal; 1600 n=4 is also +2.01%. Priority is one or two more tests at both distances. |
| Flux Dagger | — | **2000 provisional** | 3 @2000 | 16.960 | **+1.49%** | HIGH-POTENTIAL | Excellent 2000 small sample, but n=3 is insufficient for promotion. |
| Titan Mage | 12 · 6B/1Y | **1800** | 5 @1800 | 17.066 | **+1.92%** | **STRONG** | Strongest minimally sampled global-relative median in the roster. Trial also gave heavy Blue/Yellow support at 1600 and one Blue at 2200. |
| Mistfall | — | **1600** | 8 @1600 | 16.888 | +0.70% | STRONG/WATCH | Clear positive 1600 signal with useful sample; longer-distance evidence is thinner. |
| Forge Serpent | 6 · 5B/2Y | **2200; test 2000** | 18 @2200 | 16.825 | +0.80% | **STRONG** | Heavy Trial star support at 2200. 2000 n=3 is even faster relative to benchmark (+1.66%), so that distance deserves more work. |
| Starline | — | **1200/1000** | 20 @1200 | 17.021 | +0.79% | **STRONG** | Deep Sprint samples are consistently above global average: 1200 +0.79%, 1000 +0.72%. |
| Blue Vortex | — | **1000** | 28 @1000 | 17.582 | +1.00% | **STRONG** | Deep and stable 1000 evidence. |
| Silent Bruiser | — | **1600** | 5 @1600 | 16.956 | **+1.10%** | HIGH-POTENTIAL | Strong 1600 signal; 1400 n=13 is only modestly above global average. |
| Divine Riot | — | **1800; broad 1600–2200** | 5 @1800 | 16.992 | **+1.47%** | **STRONG** | Strong 1800 signal plus 1600 n=13 +0.98% and 2200 n=11 +0.80%. |
| Phantom Panther | — | **1600** | 6 @1600 | 16.932 | **+0.96%** | HIGH-POTENTIAL | Strong 1600 signal; 1400 n=13 is approximately global-average. |
| Edge Panther | 5 · 0B/0Y | 1600 provisional; drop 2200 focus | 3 @1600 | 16.889 | +0.70% | CONTINUE/LOW | Trial 2200 was n=5, no stars, +0.06% vs global average. 1600 small sample is more interesting. |

## Eight newest breeds — what the completed trial changed

The mid-trial snapshot provides a clean before/after count comparison for the eight newest Cores:

- **Frozen Blade:** Trial added 3×1000 observations. 1000 best speed rose from 17.319 to **17.992 m/s**, but final 1000 median is only 17.215 m/s and below global average. Yellow-star support does not yet translate to central speed.
- **Frost Rocket:** Trial added 3×1000. The 1000 median moved from a single 17.308 observation to **17.585 m/s across n=4**, with best **17.981 m/s**. This is a materially better post-trial Sprint signal.
- **Cyber Overdrive:** Trial added 5×1600. All five Trial races assigned Blue, but the overall 1600 median stayed essentially flat/slightly lower at **16.743 m/s**, -0.17% vs global average. This is the clearest star-vs-speed conflict.
- **Iron Dynamo:** Trial added 5×1600. Median stayed around **16.745 m/s**, but best speed improved from 17.008 to **17.369 m/s**. That suggests ceiling/variance rather than a strong 1600 central tendency.
- **Nervy Runner:** Trial added 3×1000. Median softened from 17.636 to **17.573 m/s** but remains +0.94% vs global average with n=11. 1000 remains strongly preferred.
- **Creeper:** Trial added 4×1600, where median is **16.715 m/s (-0.33%)** despite 2 Blue + 1 Yellow. Her existing 2200 n=8 signal remains much stronger at **16.804 m/s (+0.68%)**.
- **Final Flash:** Trial added 6×2200. Median **16.724 m/s (+0.20%)**, no Blue/Yellow. This does not support 2200 as a priority; return the discovery focus toward 1400/1600.
- **Peak Crown:** Trial added 6×2200. The median stayed extremely strong after expanding from n=8 to n=14: **16.866 m/s (+1.05%)**, with 3 Blue + 3 Yellow assignments. This is the cleanest speed-plus-stars validation among the newest breeds.

## Current trial-derived priorities

### Promote / strongest evidence
1. Titan Mage — 1800 primary; broad Middle/Long support.
2. Peak Crown — 2200.
3. Forge Serpent — 2200 now, priority test 2000.
4. Nervy Runner — 1000.

### High-priority next testing
- Frost Rocket — 1000; get past n=5.
- Creeper — 2200/2000 rather than 1600.
- Livid Jaguar — 1600 and 2000; both n=4 and exceptional relative to benchmark.
- Flux Dagger — 2000; n=3 but strong.
- Violet Jaguar — 1800.
- Silent Bruiser — 1600.
- Phantom Panther — 1600.

### Distance redirects / unresolved
- Frozen Blade — do not chase 1000 based on Yellow stars alone; test 1200/1400.
- Cyber Overdrive — 1600 stars are excellent but speed is not; test 1000/1200/1400 before judging.
- Iron Dynamo — 1600 is not currently convincing; shift toward 1800/2000/2200.
- Final Flash — 2200 is not convincing; test 1400/1600.
- Edge Panther — reduce 2200 priority; investigate 1600.

## Interpretation

Raw Blue/Yellow star assignment is field-relative supporting evidence and must not override materially stronger speed evidence. Peak Crown and Forge Serpent show useful agreement between stars and speed. Cyber Overdrive, Frozen Blade and Creeper at 1600 show why stars cannot be used alone: their star signals are encouraging, but their exact-distance median-speed evidence is not currently elite at those same distances.
