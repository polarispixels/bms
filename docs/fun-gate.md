# Milestone 2 Fun Gate — Notes

Date: 2026-08-17. Played via `npm run play` (seed 20260817): the scripted happy
path, a pure-stall run to collapse, and an out-of-order probe run.

## Verdict: PASS

The core loop is fun. The tension the spec wanted — acting quickly vs. acting
fairly — is present and legible in the meters. The writing does the heavy
lifting: Beverly's "She sounds sorry about it. She is not." lands exactly the
wince the spec asked for, and the room visibly waking up when the chair
hesitates (Ruth's needling, Dee's eruptions) makes passivity feel bad without a
single "wrong!" label. The out-of-order trap (calling a vote with no motion)
produces an immediate, in-fiction rebuke and a point of order to rule on —
consequence-as-feedback works.

## What played well

- Happy path: 18 turns, ~4 minutes of reading. Right length for Level 1.
- Collapse from stalling takes 11 wasted turns — slow enough to see it coming,
  fast enough to feel earned. The meter bar draining is genuinely tense.
- Gavel timing feels good: +8 for restoring order after Dee's outburst reads as
  competence.
- The inquiry ("Marcy said at the pool it's two-thirds") is the best teaching
  beat in the scenario — a rules question the player must actually know.

## Issues found, ruled into a tuning pass (T9b)

1. **A flawless chair gets a C in fairness.** No positive trust delta exists,
   so fairness = final trust caps at 70. Fix: new `FAIR_RULING` key (trust +3,
   fired alongside `CORRECT_RULING`), and fairness rescored as
   `100 − 2·(70 − trust) − 5·selectiveRecognitionCount` (clamped 0–100) so an
   untarnished baseline reads as an A and lost trust hurts double.
2. **The collapse diagnostic misattributes the spiral.** Magnitude-sorting
   individual deltas surfaced three −4 "stabilizer rescue" lines when the
   actual cause was ten −3 hesitations (−30 total). Fix: aggregate by reason
   since the checkpoint and show the top 3 by total magnitude with counts
   ("−30 across 10 turns: the chair kept waiting").
3. **The stabilizer starves the interrupter.** Ruth's every-turn rescue
   consumes the one archetype scene per turn, so in a pure-stall game Dee
   never erupts — the mechanic that punishes passivity never fires. Fix:
   2-turn cooldown after a stabilizer rescue. (Side benefit: less line
   repetition from Ruth.)

Deferred (backlog, not blocking): beats keyed to absolute `turnGte` don't fire
for unusually fast players (meeting just runs shorter — acceptable); interrupter
impatience is unbounded while an interrupt is pending (double eruptions after
long standoffs are arguably deserved); README `--learn` description predates the
IN_ORDER-only fix and gets corrected in the tuning pass.
