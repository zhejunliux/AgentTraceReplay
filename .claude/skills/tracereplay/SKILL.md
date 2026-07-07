---
name: tracereplay
description: Convert an agent run (raw logs, chat transcript, ReAct trajectory, ATIF, or an existing OTLP export) into a JSON file that AgentTraceReplay can play back. Use when the user wants to visualize / replay an agent run, or mentions AgentTraceReplay, a .otlp.json trace, or "drop this into the timeline".
---

# AgentTraceReplay format conversion

AgentTraceReplay plays back an agent run as a scrubbable timeline. It runs 100% in the
browser — the user drops one JSON file onto the page. This skill's job: turn
whatever the user has into one of the shapes AgentTraceReplay auto-detects.

## Step 1 — identify what the user has

Look at the source data and match it to a target format. In rough order of fidelity:

| The user has | Convert to | How |
| --- | --- | --- |
| An OTLP export with `gen_ai.*` attributes | nothing — it already works | drop as-is |
| **ATIF** (`{ steps: [...] }`, has real timestamps + token metrics) | OTLP | `node scripts/atif-to-otlp.mjs <in> [out]` |
| **ReAct / DAComp trajectory** (`{ trajectory: [...] }`) | OTLP | `node scripts/trajectory-to-otlp.mjs <in> [out]` |
| A raw chat transcript (OpenAI / Anthropic messages) | Chat-messages shape | hand-write JSON (below) — no timestamps needed |
| Anything else (custom logs) | Chat-messages OR trajectory shape | map fields by hand (below) |

Prefer OTLP when the source has **real timestamps** — it gives a real-time axis.
Formats without timestamps get a synthetic "step N" axis, which is fine.

## Step 2 — run the converter (if one fits)

The two converters live in `scripts/` and take an input path and optional output path:

```bash
node scripts/atif-to-otlp.mjs run.json run.otlp.json
node scripts/trajectory-to-otlp.mjs trajectory.json trajectory.otlp.json
```

Both preserve everything: reasoning, tool name/args/result, errors, and (ATIF only)
token + cache counts. Hand the resulting `.otlp.json` to the user to drop onto the page.

## Step 3 — or hand-write a supported shape

If no converter fits, emit one of these two shapes directly. AgentTraceReplay auto-detects
by signature field (`messages[]` vs `trajectory[]`), so no config is needed.

**Chat messages** (OpenAI / Anthropic — laid out on a step axis):

```json
{
  "messages": [
    { "role": "system", "content": "You are a coding agent." },
    { "role": "user", "content": "fix the failing auth test" },
    { "role": "assistant", "content": "Let me look.",
      "tool_calls": [{ "id": "c1", "function": { "name": "Bash", "arguments": "{\"cmd\":\"pytest\"}" } }] },
    { "role": "tool", "tool_call_id": "c1", "name": "Bash", "content": "1 failed" }
  ]
}
```
Anthropic content blocks (`tool_use` / `tool_result`) and a per-message `usage` object
(for token stats) are also read.

**Agent trajectory** (ReAct — thought / action / observation, step axis):

```json
{
  "task": "fix the failing auth test",
  "trajectory": [
    { "thought": "run the tests", "action": "Bash(cmd=\"pytest\")", "observation": "1 failed" },
    { "thought": "found it", "response": "patched the token check" }
  ]
}
```
`action` is parsed as `ToolName(args…)`; `response` is surfaced as the step's final reply.

## Notes

- To signal a failed step in OTLP, set the span `status.code` to `2` or add an `error.type`
  attribute — AgentTraceReplay lights it up red on the timeline.
- The tool name drives which lane a call lands on (command / file / query / search / network),
  matched by substring — so `read_file`, `run_bash`, `web_fetch` sort themselves automatically.
- Adding a brand-new source format to the app itself (not just converting a file) means writing
  one `(json) => ReplayModel` adapter in `src/model/` and registering it in `src/model/detect.ts`.
