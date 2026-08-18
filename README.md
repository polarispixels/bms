# Order! A Board Meeting Simulator

Order! is a game that teaches parliamentary procedure through interactive play. You take the role of a board chair managing a meeting with deterministic rules driven by a React UI. The game engine applies consistent parliamentary rules, procedural motions, and outcomes to simulate a realistic board meeting experience.

**Play now:** [polarispixels.github.io/bms](https://polarispixels.github.io/bms/)

## How to play

You're the chair. A scenario hands you an agenda and a room full of characters,
each playing an archetype — a Stickler who knows the rulebook, a Rambler who
won't yield the floor, a Drifting Commenter who wanders off-topic, and others —
and it's your job to keep the meeting moving without losing the room.

Every turn you pick an action from a palette built from what's actually legal
right now: recognize a speaker, entertain a motion, call for a second, open or
close debate, call the vote, rule on a point of order, or just wait and see
what happens. Two meters track how you're doing — **Control**, how well the
room is following the rules, and **Trust**, how much the room believes you're
being fair — and they move in response to your calls, not just the clock.
Ruling loosely keeps things friendly but bleeds Control; ruling strictly by
the book keeps order but can cost Trust if it reads as arbitrary.

Let either meter run out and the meeting **collapses**: you get a short
diagnostic on what tipped it over and the option to restore to your last
checkpoint and try again. Play a scenario through to adjournment instead and
you get a report card grading how you chaired it. There's no clock and no
hidden dice against you — every outcome traces back to a ruling you made.

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
prompt for it afterward. It reads from stdin, so it works both at a TTY and
piped from a script, and exits cleanly with a summary line on EOF.

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
