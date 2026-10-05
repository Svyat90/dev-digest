# Retro report template

Copy into `docs/retros/<YYYY-MM-DD>-<topic>.md`. Every number comes from
`collect.mjs`; write "not measured" rather than estimating. Token counts and
durations are written in the human form from the script's `display` fields —
`86k`, `1.4M`, `45 s`, `2 min 11 s`, `12 h 37 min` — never as raw figures
like `31,009,828` or `756.6 min`. Gantt times stay `HH:mm:ss`. Delete a section's
placeholder line only when the section is genuinely empty, and say "none".

````markdown
# Retro: <topic> — <YYYY-MM-DD>

Session: `<session id>` · Window: <since> → <until> · Branch: `<branch>`
Workflow: <e.g. spec-creator × 3 rounds, run-plan on docs/plans/…>

## Summary

- Tokens: <display.tokens.total.output> out · <display.tokens.total.cacheRead> cache read · <display.tokens.total.cacheWrite> cache write · cache hit <ratio> · agents <agentShare>
- Cost: $<costUsd> API-equivalent (or "not measured: no price for <model>")
- Agents: <count> (<byType>) · <dispatches> dispatches · max <maxConcurrent> in parallel
- Wall time: <display.wall> · main session active <display.mainActive>
- Verdict: <one sentence — what to change first>

## Timeline

```mermaid
gantt
  dateFormat HH:mm:ss
  axisFormat %H:%M
  section <type#order>
  <dispatch 1> :<start>, <end>
```

## Agents

| # | Agent | Dispatches | Active (`display.active`) | Tool calls | Ramp-up | Errors | Status | Tokens out (`display.tokens.output`) |
|---|-------|-----------|--------|-----------|---------|--------|--------|------------|

### <type#order> — <description>

- **Hard:** <finding> — <evidence>
- **Easy:** <finding> — <evidence>
- **Duplicated:** <finding> — <evidence>
- **Missed:** <finding> — <evidence>
- **Claims checked:** <claim> → held / did not hold (<command or path>)

## Across agents

- Order and parallelism: <…>
- Token hotspots: <…>
- Shared reads: <files read by ≥ 2 actors, and whether the brief could have carried them>
- Human friction: <questions vs calls, rejections, clarifications, recommended options accepted unchanged>

## Recommendations

| # | Change | File | Metric it should move | Evidence |
|---|--------|------|-----------------------|----------|

Each row is followed by the proposed diff or exact sentence:

```diff
<file>
- <old line>
+ <new line>
```

## Insight candidates

Findings that may pass the `engineering-insights` gate, or "none".
````
