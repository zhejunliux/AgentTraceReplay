---
name: add-adapter
description: Scaffold a new input-format adapter for AgentTraceReplay — a pure (json) => ReplayModel function in src/model/, wired into detect.ts. Use when the user wants AgentTraceReplay to natively support a new trace/log format (Langfuse, LangSmith, a custom in-house schema, etc.) rather than one-off converting a single file. For converting an existing file, use the `tracereplay` skill instead.
---

# Add an AgentTraceReplay input-format adapter

AgentTraceReplay's UI depends on exactly one internal shape, `ReplayModel`. Every input
format is a pure function `(json) => ReplayModel`. Supporting a new format means
writing one such adapter and registering it — nothing in the UI changes.

Use this skill when the user wants **native, auto-detected** support for a format
(so anyone can just drop that format in). To convert a single file once, use the
`tracereplay` skill instead.

## The contract

Read these two files first — they are the entire contract:

- `src/model/types.ts` — the `ReplayModel` / `ReplaySpan` / `Message` shapes you must produce.
- `src/model/detect.ts` — how formats are detected and routed.

Study one existing adapter closest to the new format before writing:

- `src/model/otlpAdapter.ts` — real timestamps, nested spans, token usage. The richest example.
- `src/model/messagesAdapter.ts` — OpenAI / Anthropic chat logs on a synthetic step axis.
- `src/model/trajectoryAdapter.ts` — ReAct thought/action/observation steps.

## Steps

1. **Confirm scope.** Get a representative sample of the new format from the user.
   Decide: does it carry real timestamps (→ time axis) or not (→ step axis)?

2. **Write `src/model/<name>Adapter.ts`.** Export `<name>ToReplayModel(doc, fallbackTitle?)`.
   - Map each unit of work to a `ReplaySpan`. Set `track` via `operation` (see
     `trackFor` in otlpAdapter) and, for tools, `toolTrack(name)` from `src/model/toolTrack.ts`.
   - For real timestamps: set `tStart`/`tEnd` in ms relative to run start, `timeAxis: 'time'`.
   - For no timestamps: lay spans out on the step axis (`STEP_MS` per step) and call
     `buildModel({ ..., timeAxis: 'step' })` from `src/model/buildModel.ts`, which fills
     depth, duration, and token totals for you.
   - Populate `inputMessages` / `outputMessages` / `toolArguments` / `toolResult` / `tokens`
     when the source has them — the inspector and analysis panel read these.

3. **Register in `src/model/detect.ts`.** Add a signature check (a top-level field
   unique to the format) that routes to your adapter, ordered so it can't be shadowed
   by an earlier, looser check. Detection must never throw — let the adapter throw on
   genuinely malformed data.

4. **Verify.**
   - `npm run build` must pass (strict TS: no unused vars/params, no implicit any).
   - Drop a sample file in `npm run dev` and confirm lanes, playback, and the span
     inspector render what you expect.

## Guardrails

- **Don't touch the UI or `types.ts`.** If you feel you need a new field on `ReplaySpan`,
  stop and discuss — the point of the model is that the UI never learns about input shapes.
- Coerce defensively: inputs are untrusted JSON. Guard `typeof` / `Array.isArray` before
  reading fields; fall back rather than throw on a single bad record.
- Keep it pure: no network, no globals, no `Date.now()`/`Math.random()` — same input must
  always produce the same model.
- If detection is ambiguous (no clean signature field), prefer extending the heuristic
  scanner in `src/model/heuristicAdapter.ts` over a fragile top-level guess.
