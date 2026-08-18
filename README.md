# Order! A Board Meeting Simulator

Order! is a game that teaches parliamentary procedure through interactive play. You take the role of a board chair managing a meeting with deterministic rules driven by a React UI. The game engine applies consistent parliamentary rules, procedural motions, and outcomes to simulate a realistic board meeting experience.

**Play now:** [polarispixels.github.io/bms](https://polarispixels.github.io/bms/)

## How to play

**You are the chair.** A scenario hands you an agenda and five people who have
all been to this meeting before, and your job is to get through the business
without the room deciding it can do this without you.

Each turn you pick one action from the palette. The whole vocabulary:

| | |
|---|---|
| **Call the item** | open the meeting, or move on to the next thing on the agenda |
| **Recognize** | give a member the floor — to move something, second it, or speak |
| **State the motion** | put the question to the board, which is what makes debate legal |
| **Rule** | decide a point of order well taken or not well taken |
| **Answer inquiry** | answer a member's question about procedure, correctly or otherwise |
| **Call the vote** | by voice, or by roll call |
| **Announce the result** | say out loud what the board just decided |
| **Gavel** | quiet an interruption; on a quiet room it just draws attention |
| **Recess** | a few minutes to let the temperature drop |
| **Adjourn** | end it |
| **Wait** | say nothing and see what the room does |

**Practice mode is the default, and it does not tell you what's legal.** Every
action stays on the palette whether or not it's in order, with no greying out,
no warnings and no hints — greying out the wrong answers is an answer key. You
find out the way you'd find out in a real meeting: you try it, and the room
reacts. Call a vote on a motion you never stated and nothing gets voted on;
somebody looks up, confused, and the member who knows the rulebook files a
point of order about it. **Learn mode** is the other setting: it shows only
the moves that are in order right now, each with the reason it's in order.

Above the palette sit two things that tell you where you are without telling
you what to do: **the floor** — one line of plain English for what is happening
right now — and a strip of chips for everyone visibly waiting on you, a raised
hand, a point of order or a question apiece, oldest first, each one tappable as
a shortcut to dealing with that person.

Stuck either way? The **Hint** button asks the clerk what to do next — one
suggestion, one line of reasoning, no turn spent — and it's there in both
modes.

The room is five archetypes, and each one is a mechanic rather than a
decoration. **The Rules Enthusiast** files a point of order every time you skip
a step, and is almost always right. **The Veteran** wants the floor to explain
that the board settled this years ago; ignore them long enough and they give up
in a way everyone notices. **The Interrupter** talks over you, and does it
sooner the longer you hesitate — passivity is a choice the game charges you
for. **The Stabilizer** quietly does your job when you flounder, which fixes
the immediate problem and tells the room who is actually running the meeting.
**The Drifting Commenter** wanders; gaveling them costs you, and letting them
run costs you too.

Two meters, both visible. **Control** is whether the room defers to the chair.
**Trust** is whether it thinks you're fair. They pull against each other, on
purpose: perfect Control is available to anyone willing to be a tyrant about
it. Only Control ends the meeting — at zero the room **collapses**, everyone
talks at once, whatever was on the floor dies, and the gavel stops meaning
anything. Trust never collapses the meeting on its own; it shows up in how the
room treats you along the way, and on your report card at the end.

A collapse is not a restart. The game rewinds to your last checkpoint — taken
at each agenda item and just before each vote — and shows a short diagnostic of
the two or three things that actually cost you the room, aggregated, so ten
small hesitations read as the one problem they were.

Get to adjournment and you get a report card: procedure, fairness, efficiency,
clarity, agenda completion, each with a grade and notes, plus a pedantic list
of specific moments. No clock, no dice rolling against you — same scenario,
same seed, same choices, same meeting, every time.

## Development

- **Development server:** `npm run dev`
- **Run tests:** `npm test` (or `npm run test:watch` for watch mode)
- **Play/demo script:** `npm run play`
- **Build for production:** `npm run build`

### Headless CLI playthrough

`npm run play` (`scripts/play.ts`) drives the engine from the terminal: it prints
rendered events, `[CTRL ██████░░░░ 60] [TRUST ███████░░░ 70]` meters, a
phase/item/floor/stack summary, pending requests, and a numbered action
palette built from `legalActions`. Type a number to pick an action; verbs that
need a target (`RECOGNIZE`, `RULE`, `ANSWER_INQUIRY`, `CALL_VOTE`, `RECESS`)
prompt for it afterward. Typing `h` instead of a number asks the clerk what to
do next and re-shows the same menu — a constant entry that never shifts the
numbers above it, so scripted/piped input stays valid. It reads from stdin, so
it works both at a TTY and piped from a script, and exits cleanly with a
summary line on EOF.

Flags:

- `--seed N` — RNG seed (default `1`)
- `--scenario id` — scenario id to play (default: the first one in `src/content`)
- `--learn` — filters the palette down to only `IN_ORDER` actions, shown with
  reasons. Without it (the default "practice" mode) every verb is listed with
  no indication of its legality — you find out by trying it.

On `ADJOURNED` it prints the report card; on `COLLAPSED` it prints a 3-line
diagnostic (the worst meter hits since the last checkpoint) and asks whether
to restore to that checkpoint and keep playing.

A scripted happy path (translated to menu numbers from the chair actions in
`src/content/__tests__/hoa-fence-01.test.ts`'s `HAPPY_PATH`) reaches the
report card with an A overall grade:

```sh
printf '1\n2\n1\n3\n6\n1\n7\n1\n2\n5\n3\n2\n3\n8\n2\n1\n5\n1\n1\n8\n4\n1\n2\n2\n2\n6\n1\n7\n10\n' | npm run play -- --seed 20260817
```

## Architecture

- `src/engine` — the rules: room state, motions, legality, meters, checkpoints,
  reducer, report cards. Pure TypeScript, no React and no DOM dependency — it
  runs headless, which is what `npm run play` and the engine test suite both
  rely on.
- `src/content` — scenarios as data: agendas, characters, and scripted beats,
  validated against a schema and loaded by id.
- `src/modes` — the practice/learn action-palette split layered on top of the
  engine's legality checks.
- `src/ui` — the React shell: renders engine state, turns clicks into engine
  actions, and adds nothing to the rules themselves.

## License

Code is MIT licensed — see [LICENSE](./LICENSE). Scenario and character
content is original to this project.
