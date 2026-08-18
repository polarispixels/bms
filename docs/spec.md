# Order! A Board Meeting Simulator

**Version:** 0.2 (planning, pre-build)
**Status:** Scope locked for MVP

---

## 1. Premise

A flight simulator for board meetings. The player is the chair. The room does not
wait, does not behave, and does not care that you read the rulebook.

The player learns parliamentary procedure by presiding over meetings, not by
looking rules up. Mistakes are never labeled "wrong." The meeting simply reacts:
members get confused, someone raises a point of order, the audience gets loud,
the agenda slips.

**The MVP answers exactly one question:** is running a simulated meeting fun
enough that someone starts a second scenario?

Everything that does not serve that question is backlog.

---

## 2. Design Principles

1. **The rules engine is deterministic. AI never decides legality.** An LLM may
   write dialogue and author content. It never rules on whether a motion is in
   order.
2. **React, don't grade.** No "Correct!" popups during play. Consequence is the
   feedback.
3. **A legal action is not always a good action.** Ruling a friendly member out
   of order on a technicality is legal and costs you the room.
4. **Difficulty is one dial, not three.** Input freedom, time pressure, and
   content variability all move together along a single assistance axis.
5. **Silence is a move.** Hesitation and inaction produce consequences too.

---

## 3. Difficulty Axis

The three earlier open questions collapse into one ladder:

| Tier | Input | Pacing | Content |
|------|-------|--------|---------|
| Beginner | Verb + target palette | Turn based | Static authored |
| Intermediate | Palette + free text | Soft turn budget | Static, multiple variants |
| Advanced | Free text only | Live clock | Generated |

**MVP ships Beginner only.** The architecture must make the other two tiers a
matter of swapping the input adapter and the content source, never a rewrite.

---

## 4. Architecture

### 4.1 The two interfaces that matter

Everything else is negotiable. These two are not.

**Action objects.** Every player move becomes a canonical object before it
reaches the engine.

```ts
type Action =
  | { verb: 'CALL_ITEM' }
  | { verb: 'RECOGNIZE'; target: MemberId }
  | { verb: 'STATE_MOTION' }
  | { verb: 'RULE'; target: RequestId; ruling: 'WELL_TAKEN' | 'NOT_WELL_TAKEN' }
  | { verb: 'ANSWER_INQUIRY'; target: RequestId; answer: AnswerId }
  | { verb: 'CALL_VOTE'; method: 'VOICE' | 'ROLL_CALL' }
  | { verb: 'ANNOUNCE_RESULT' }
  | { verb: 'GAVEL' }
  | { verb: 'RECESS'; minutes: number }
  | { verb: 'ADJOURN' }
  | { verb: 'WAIT' };
```

The palette emits these directly. In a later tier, an LLM parser emits the same
objects from typed English. The engine cannot tell the difference and must never
need to.

**Event objects.** The engine emits state changes. A renderer turns each into a
line of speech.

```ts
type MeetingEvent = {
  id: string;
  type: 'SPEECH' | 'STATE_CHANGE' | 'INTERRUPT' | 'VOTE_RESULT' | 'NARRATION';
  actor: MemberId | 'CHAIR' | 'CLERK' | 'AUDIENCE' | 'SYSTEM';
  intent: string;        // e.g. 'MOVE_AMENDMENT', 'OBJECT_GERMANENESS'
  payload: Record<string, unknown>;
};
```

Authored dialogue and generated dialogue both fill the same slot. Content source
becomes a swap, not a refactor.

### 4.2 Meeting state

```ts
type MeetingState = {
  agenda: AgendaItem[];
  currentItem: number;
  quorumPresent: boolean;
  members: Member[];
  floorHolder: MemberId | null;
  motionStack: Motion[];       // main motion at the bottom, amendments above
  pendingRequests: Request[];  // recognition, point of order, inquiry
  phase: 'PRE_MEETING' | 'ITEM_OPEN' | 'MOTION_PENDING' | 'DEBATE'
       | 'VOTING' | 'RECESS' | 'ADJOURNED' | 'COLLAPSED';
  meters: { control: number; trust: number };
  turn: number;
  log: MeetingEvent[];
};
```

The motion stack is the heart of it. An amendment to an amendment is just depth
three, and vote requirements, debatability, and precedence all read off the top
of the stack.

### 4.3 Legality

The engine exposes `legalActions(state): LegalityReport`, which returns every
verb with a status of `IN_ORDER`, `OUT_OF_ORDER`, or `RISKY`.

**The UI does not hide illegal actions in Practice or Simulate mode.** Greying
out the wrong answers is an answer key and destroys the learning. Illegal moves
stay clickable and produce consequences. Only Learn mode restricts the palette.

### 4.4 Stack

- Vite + React + TypeScript, deployed as a static site.
- The engine lives in `/src/engine` as pure TypeScript with zero React imports,
  fully unit tested. It must be runnable from a Node script with no browser.
- Scenario content is static JSON in `/src/content`. No runtime API calls in the
  MVP.
- State handled with a reducer. The engine is already a reducer, so this is free.

```
/src
  /engine      rules, motion stack, legality, meters, tests
  /content     scenarios as JSON
  /ui          palette, transcript, state panel, meters
  /modes       learn, practice, simulate
```

---

## 5. Content Pipeline

Use Claude at **authoring time**, not runtime. Generate several variants of each
scenario with different member personalities and different failure paths, then
commit them as JSON.

This gets most of the replayability benefit with none of the runtime cost,
latency, or failure modes. Live generation is a Tier 3 upgrade, deliberately
deferred.

Scenario schema, roughly:

```json
{
  "id": "hoa-fence-01",
  "title": "The Fence Variance",
  "body": "Willow Creek HOA Board",
  "seats": 5,
  "quorum": 3,
  "members": [
    {
      "id": "m1",
      "name": "...",
      "archetype": "RULES_ENTHUSIAST",
      "objective": "...",
      "triggers": ["MOTION_MISSTATED", "AMENDMENT_NOT_GERMANE"],
      "lines": { "OBJECT_GERMANENESS": ["...", "..."] }
    }
  ],
  "agenda": [...],
  "beats": [...],
  "checkpoints": [...]
}
```

---

## 6. Characters

Personalities are mechanics, not decoration. Each archetype has a trigger
condition and a behavior, so the same procedural mistake reliably summons the
same headache.

- **The Rules Enthusiast.** Fires a point of order whenever the chair misstates
  a motion or accepts a non-germane amendment. Usually right. Exhausting.
- **The Veteran.** Insists the board already settled this in 2019. Attempts to
  short-circuit debate. Costs Efficiency if unmanaged, costs Trust if silenced.
- **The Interrupter.** Speaks without recognition, more often the longer the
  chair hesitates. This is the mechanic that punishes passivity.
- **The Stabilizer.** Competent. Will quietly make the right procedural motion if
  the chair flounders, which rescues the meeting but reads as weak chairmanship.
- **The Drifting Commenter.** Public comment that wanders off topic. Cutting them
  off costs Trust. Letting them run costs Efficiency. There is no clean answer,
  which is the point.

Humor comes from accuracy. Anyone who has sat through one of these should wince
in recognition. No cartoons.

---

## 7. Scoring and Failure

**During play, two meters only.**

- **Control.** Does the room defer to the chair? Falls on unaddressed
  interruptions, misstated motions, hesitation, and lost track of the motion
  stack.
- **Trust.** Do members and the public think you are fair? Falls on selective
  recognition, cutting off allies of one side, and technicality rulings against
  people who are substantively right.

They pull against each other on purpose. Maximum control is achieved by being a
tyrant.

**Collapse.** If Control hits zero, the meeting devolves. Members talk over each
other, the motion is lost, the room stops recognizing the chair, and the state
moves to `COLLAPSED`. This is a real fail state and should feel bad.

**Restart from beat.** Collapse rewinds to the last checkpoint, not to the start.
Checkpoints sit at agenda-item boundaries and just before votes. The rewind shows
a short diagnostic of the two or three decisions that led to the spiral.

**Report card, post-meeting only.** Procedural correctness, fairness, efficiency,
clarity, agenda completion. Detailed and pedantic, because that is where pedantry
belongs.

---

## 8. Levels

Progression follows legal formality, not topic.

**Level 1: Willow Creek HOA, The Fence Variance.**
Five owners. Framing device: the board adopted strict Robert's Rules last year
after an argument, so a tiny body now runs formally. This avoids teaching
small-board exceptions before fundamentals.
Teaches: quorum, calling an item, main motion, second, recognition, debate, voice
vote, announcing a result.
Target: 5 minutes.

**Level 2: Township Zoning Variance.**
Public comment period, a divided room, an applicant present.
Adds: amendments and germaneness, points of order, managing public comment,
restating a motion accurately, ruling from the chair.
Target: 8 to 10 minutes.

**Level 3: County Commission Resolution.**
Statutory formality, a clerk, a record, a hostile audience.
Adds: roll call votes, table versus postpone versus refer, calling the question,
executive session, reconsideration, sunshine constraints.
Target: 12 to 15 minutes.

---

## 9. MVP Scope Lock

**In:**
Level 1 only. Palette input. Turn based. Static content. Two live meters.
Collapse and checkpoint restart. Post-meeting report card. One-screen UI showing
transcript, current parliamentary state, and the palette.

**Out, explicitly:**
Free text input. Timers. Runtime AI. Levels 2 and 3. Roles other than chair.
Multi-jurisdiction rule layering. Accounts, saves, analytics, monetization.

Keep rulesets as data so jurisdiction layering is possible later. Do not build
the abstraction now.

---

## 10. Milestones

1. **Engine and tests.** Motion stack, legality, meters, collapse. Playable from
   a Node script with no UI. Do not skip this ordering.
2. **Ugly playable.** Level 1 end to end in plain HTML. The fun test happens here,
   before any visual polish, because polish will otherwise mask a boring core.
3. **UI.** Transcript, state panel, meters, palette, report card.
4. **Content variants.** Three to six authored variants of Level 1.
5. **Levels 2 and 3.**
6. **Free text parser** mapping English to Action objects.

Gate at milestone 2. If it is not fun in plain HTML, fix the design rather than
building milestone 3.

---

## 11. Legal Note

Robert's Rules of Order Newly Revised (12th ed.) is under copyright. All rule
text in the app must be original paraphrase, or drawn from the 1915 public domain
edition. Do not paste modern rulebook language into help text or explanations.
