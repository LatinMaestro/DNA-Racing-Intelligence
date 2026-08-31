# Season 12 official schedule

## Authority

This is a transcription of the official DNA Racing Season 12 schedule image
supplied by the repository owner on 31 August 2026.

Source image SHA-256:
`c6d9c1f38bff8cab308a119c89e1899215dcb74dd86a2de5e2bfc70f6f734516`.

The image publishes month/day plus weekday rather than a printed year. Every
date aligns exactly with its published weekday in 2026, and the image was
supplied in the current Season 12 planning context. The canonical schedule
therefore records 2026 dates and retains the source weekday as an independent
validation field.

Calendar shorthand follows the existing owner-confirmed distance mapping:
`10 = 1000 m`, `12 = 1200 m`, `14 = 1400 m`, `16 = 1600 m`, `18 = 1800 m`,
`20 = 2000 m` and `22 = 2200 m`.

## Published calendar

| Date       | Day   | Event        | Mode        | Distances          | Eligible    |
| ---------- | ----- | ------------ | ----------- | ------------------ | ----------- |
| 2026-09-14 | Mon   | Splice 1     | Car         | All                | Unspecified |
| 2026-09-17 | Thurs | Spin Battles | Horse       | 1000, 1600, 2000 m | Spliced     |
| 2026-09-21 | Mon   | Spin Battles | Car         | 1200, 1800, 2200 m | Spliced     |
| 2026-09-24 | Thurs | Side Event   | Unspecified | Unspecified        | Unspecified |
| 2026-09-28 | Mon   | Spin Battles | Bike        | 1000, 1800, 2200 m | All         |
| 2026-10-01 | Thurs | Side Event   | Unspecified | Unspecified        | Unspecified |
| 2026-10-05 | Mon   | Splice 2     | Horse       | All                | Unspecified |
| 2026-10-08 | Thurs | 1v1 Wars     | Car         | 1200, 1600, 2000 m | All         |
| 2026-10-12 | Mon   | 1v1 Wars     | Bike        | 1000, 1600, 2200 m | Spliced     |
| 2026-10-15 | Thurs | Side Event   | Unspecified | Unspecified        | Unspecified |
| 2026-10-19 | Mon   | 1v1 Wars     | Horse       | 1000, 1400, 2200 m | All         |
| 2026-10-22 | Thurs | Side Event   | Unspecified | Unspecified        | Unspecified |
| 2026-10-26 | Mon   | Splice 3     | Bike        | All                | Unspecified |
| 2026-10-29 | Thurs | Double Up    | Car         | 1200, 1600, 2000 m | Spliced     |
| 2026-11-02 | Mon   | Double Up    | Horse       | 1200, 1600, 2200 m | All         |
| 2026-11-05 | Thurs | Side Event   | Unspecified | Unspecified        | Unspecified |
| 2026-11-09 | Mon   | Double Up    | Bike        | 1000, 1400, 2000 m | All         |

## Configuration boundary

The image confirms only the calendar fields shown above. It does not establish:

- gate counts or race format beyond the published event name;
- entry fee or payout asset;
- qualification start/end times, minimum races or progression rule;
- leaderboard splits, scoring or tie-breaks;
- Side Event mode, distances or eligibility; or
- an eligibility rule for the three Splice dates.

These missing values remain unknown and must not be defaulted from a previous
season or another event. The typed catalogue in
`domain/season-12-official-schedule.ts` is safe calendar/prefill authority, not
a complete actionable `TournamentRuleConfiguration`.
