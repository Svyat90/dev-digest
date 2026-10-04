# Metrics collected by `collect.mjs`

The script reads `~/.claude/projects/<project-slug>/<session>.jsonl` (main
session) and `<session>/subagents/agent-<id>.jsonl` + `.meta.json` (one pair
per agent). It writes nothing.

## Fields

| Field | Meaning | How it is computed |
|---|---|---|
| `session.wallMs` | first to last event in the window | timestamps |
| `session.mainActiveMs` | time the main session spent working | sum of `turn_duration` events |
| `tokens.total` / `.main` / `.agents` | input, output, cacheRead, cacheWrite, thinking, turns | `message.usage`, one count per API message id (a response split across lines is counted once) |
| `tokens.cacheHitRatio` | cacheRead / (input + cacheRead + cacheWrite) | — |
| `tokens.agentShare` | agents' tokens / all tokens | all four token kinds summed |
| `costUsd` | dollars at API list prices (an API-equivalent figure on a subscription) | tokens × `prices.json`; `null` when any model's price is missing |
| `agents.list[].type` | agent type | `meta.agentType` |
| `agents.list[].order` | launch order | sorted by first event |
| `agents.list[].dispatches` / `resumes` | first brief plus each `SendMessage` | the `Agent` launch plus each main-session `SendMessage` whose `to` is this agent's id; a dispatch spans the agent's events between those calls |
| `agents.list[].activeMs` | sum of dispatch durations | first to last event per dispatch |
| `agents.list[].briefChars` | size of the first brief | — |
| `agents.list[].toolCallsBeforeFirstWrite` | ramp-up before the first Write/Edit | `null` for read-only agents |
| `agents.list[].errorsByKind` | `rejected_by_user`, `blocked_by_hook`, `bad_tool_input`, `stale_or_unread_file`, `tool_error` | `tool_result.is_error`, classified by text |
| `agents.list[].repeatedReads` | files the agent `Read` more than once | Read tool only; `cat`/`sed` in Bash are not counted |
| `agents.list[].statuses` | status per report | `Status:`, `Overall:` or `Verdict:` line |
| `agents.list[].reports` | report text, first 4,000 chars | `SubagentHandback` message, else the last assistant text |
| `agents.maxConcurrent` | most dispatches running at once | overlap of dispatch intervals |
| `timeline` | launch / resume / stop per agent | dispatch boundaries |
| `main.agentLaunches` / `agentMessages` | `Agent` calls / `SendMessage` calls | — |
| `human.messages` | messages the user typed | user lines that are not tool results or harness text |
| `human.questionsAsked` / `questionCalls` | questions / `AskUserQuestion` calls | — |
| `human.rejectedToolCalls` | tool calls the user declined | main-session errors of kind `rejected_by_user` |
| `sharedReads` | files read by two or more actors | main session counts as an actor |
| `display` / `agents.list[].display` | human-readable wall, main active, agent active time and token counts for the report | tokens: `512`, `4.2k`, `86k`, `1.4M` (one decimal below 10); durations: `45 s`, `2 min 11 s`, `12 h 37 min` |

## Known limits

- Reads through Bash (`cat`, `sed -n`, `grep`) are invisible to `repeatedReads`
  and `sharedReads`; look at the transcript when a ramp-up is long.
- An older transcript without `SubagentHandback` yields one report per agent
  (its last text), even if it was resumed.
- Time inside a dispatch includes waiting on a permission prompt.

## `docs/retros/metrics.csv` header

```
date,topic,session,agents,dispatches,max_concurrent,wall_min,output_tokens,cache_read_tokens,cache_hit_ratio,agent_share,cost_usd,errors,hook_blocks,questions,rejected_calls
```

`errors` and `hook_blocks` sum the main session and every agent. Leave
`cost_usd` empty when `costUsd` is `null`.
