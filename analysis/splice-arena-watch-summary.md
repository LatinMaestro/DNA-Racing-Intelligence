# Splice Arena Watch — Initial Baseline Findings

Fetched: 2026-08-29T10:33:22.098Z

The Bike Splice Arena snapshot contained 100 listed Cores. A second snapshot roughly five minutes after the first showed no listing additions/removals and no price changes. This run therefore establishes the initial watch baseline; the alert below is for materially better pairings discovered against the existing shortlist, not for an observed five-minute listing/price change.

## Existing comparison set

- Berserker #24298 × First Light #22145 → Earth F40 Xclass. Public stud `pair_validate` reports one or both parents not in stud; no current total price returned.
- Berserker #24298 × Reese Dylan #11848 → Water F46 Xclass. Public stud `pair_validate` reports one or both parents not in stud; no current total price returned.
- Grand Azula #9852 × First Light #22145 → Water F35 Xclass. Public stud `pair_validate` reports one or both parents not in stud; no current total price returned.
- Bright Lights #17053 × Reese Dylan #11848 → Water F30 Xclass. Public stud `pair_validate` reports one or both parents not in stud; no current total price returned.
- Bong Ripper #23835 × Low on Dough #8174 → Earth F18 Xclass; currently valid in the public stud endpoint; exact `pair_info` total is $21.

## Materially better options found

### 1. Dough #2799 × Spoiler #24936

Offspring: Water F25 Xclass. Public stud validation: valid. Exact current `pair_info` total: $15.

Dough current Bike evidence: 1600 m 37 races, 37.84% wins, 78.38% podiums, 36.36% paid-race wins; 1200 m 30 races, 33.33% wins, 76.66% podiums, 42.86% paid-race wins. Current API context: power 81.33, adjusted odds 75.58, variance 60.05.

Spoiler current Bike evidence: 1600 m 31 races, 32.26% wins, 87.10% podiums, 66.67% paid-race wins. The current power/adjusted-odds/variance object is not populated for Spoiler, so those fields are treated as unavailable rather than zero-quality evidence.

This is the strongest fully public-stud-valid 1600 m-first option found in the scan. Both parents independently have meaningful 1600 m evidence, the offspring is non-Metal and comfortably above F15, and Dough also brings genuine 1200 m evidence. It is also $6 cheaper than Bong Ripper × Low on Dough while targeting the squad's higher-priority 1600 m weakness rather than the third-priority 2200 m gap.

Ancestry: Dough is Genesis with no recorded parents/grandparents in the current splice payload; Spoiler's recorded parents are #20477 and #22070 with grandparents #171/#6446 and #458/#9473. No close-relation overlap is visible.

### 2. Bright Lights #17053 × Spoiler #24936

Offspring: Water F27 Xclass. Public stud validation: valid. Exact current `pair_info` total: $14.

Bright Lights current Bike evidence: 1200 m 194 races, 26.80% wins, 72.68% podiums, 27.72% paid-race wins; current adjusted odds 78.50, power 78.83, variance 59.67. Spoiler supplies the strong 1600 m side noted above.

This is a strong 1200 m + 1600 m complementary cross, produces a high-F Water Xclass, and is the lowest-priced fully validated option among the new shortlist. Relative to Bright Lights × Reese Dylan, Reese has much stronger sample confidence and high variance (87.37) at 1600 m, so the Spoiler cross is not a clear performance upgrade; it is a very strong value/diversification alternative.

### 3. Grand Azula #9852 × Spoiler #24936

Offspring: Water F38 Xclass. Public stud validation currently returns one or both parents not in stud because Grand Azula is owned/unlisted; `pair_info` therefore returns no total price.

Grand Azula current Bike evidence: 1600 m 48 races, 31.25% wins, 56.25% podiums; 2200 m 326 races, 26.69% wins, 67.79% podiums. Spoiler adds 31 races at 1600 m with 32.26% wins and 87.10% podiums.

This is materially stronger evidence than Grand Azula × First Light for the primary 1600 m objective because First Light's current 1600 m sample is only 5 races despite a 60% win rate. It also raises the offspring from F35 to F38 while remaining Water and retaining Grand Azula's substantial 2200 m depth. No close-relation overlap is visible in the recorded ancestry.

### 4. Redline Racer #20376 × Spoiler #24936

Offspring: Water F21 Xclass. Public stud validation currently returns one or both parents not in stud because Redline Racer is owned/unlisted; no total price is returned.

Redline Racer current Bike evidence: 1600 m 22 races, 45.45% wins, 86.36% podiums, 52.63% paid-race wins; adjusted odds 80.17, power 83.00, variance 33.94. Spoiler: 1600 m 31 races, 32.26% wins, 87.10% podiums.

This is the strongest pure 1600 m specialist pairing found on parent performance. The offspring is Water F21, so it directly reduces roster Metal dependence despite Redline Racer itself being Metal. The main trade-off is lower current variance/WTA-upside evidence from Redline Racer and essentially no 1200 m evidence from either parent.

### 5. Bright Lights #17053 × Moana #14798

Offspring: Fire F17 Xclass. Public stud validation currently returns one or both parents not in stud because Moana is owned/unlisted; no total price is returned.

Bright Lights provides the deep 1200 m evidence above. Moana current Bike evidence: 1600 m 55 races, 34.55% wins, 81.82% podiums, 31.58% paid-race wins; 1200 m 31 races, 19.35% wins. Current adjusted odds 69.92, power 78.83, variance 49.83.

This is the most structurally attractive Fire option found: it creates a non-Metal F17 Xclass while combining one of the stronger 1200 m arena sires with one of the owner's strongest 1600 m females. It is particularly useful if the final roster remains over-dependent on Metal/Water solutions.

## Other useful but secondary findings

Alien Nosejob #8665 × Spoiler #24936 is currently valid and produces Water F27 Xclass for an exact $15 total. Alien Nosejob has 121 races at 1200 m (24.79% wins, 76.86% podiums) plus 11 races at 1600 m (18.18% wins, 81.82% podiums) and variance 61.49. It is a credible balanced option but does not clearly beat Dough × Spoiler for the 1600 m-first objective.

The Ice Cream Man #11432 × Spoiler #24936 produces Water F33 Xclass. The Ice Cream Man has 30 races at 1600 m (30.00% wins) and 486 at 2200 m (30.45% wins, 69.34% podiums), making it a strong 1600/2200 depth option. Public stud validation does not pass while the owned parent is unlisted, so no exact total price is returned.

Zeppelin Quest #710 × Reese Dylan #11848 produces Water F28 Freak. Zeppelin Quest is a notable 2200 m parent (52 races, 48.08% wins, 94.23% podiums), but because 2200 m is the third priority this remains below the 1600 m-first candidates.

## Interpretation of validation

The public stud `pair_validate` endpoint rejects mixed owner-vault/unlisted pairs with “one or both parent cores not in stud.” This watch records that API fact exactly. The owner has separately confirmed that using Cores already in the vault does not incur stud fees, so public stud validation status should not be treated as proof that an owner-side vault pairing is impossible; it is simply not validated by the public stud path in the current API response.
