# Order! A Board Meeting Simulator

Order! is a game that teaches parliamentary procedure through interactive play. You take the role of a board chair managing a meeting with deterministic rules driven by a React UI. The game engine applies consistent parliamentary rules, procedural motions, and outcomes to simulate a realistic board meeting experience.

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
