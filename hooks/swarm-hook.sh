#!/bin/sh
# Swarm Protocol plugin hooks. Contract: INTEGRATION.md §3.
# Usage: swarm-hook.sh session-start | stop | gate | post-edit
# A hook never blocks a session: every path exits 0, with two deliberate exceptions. The gate hook may deny or ask
# for one edit, through the PreToolUse JSON decision on stdout, when swarm.json sets hooks.gateEdit to "block" or
# "ask" (default "warn"); and `hooks.preEdit` exiting 2 (a lease on an exclusive zone held by another live session)
# is passed on, and Claude Code then refuses that edit.

mode=$1
root=${CLAUDE_PROJECT_DIR:-$(pwd)}
manifest="$root/swarm.json"

# json <key.path> <file|-> → prints the value (arrays one item per line), empty if missing.
json() {
  if command -v jq >/dev/null 2>&1; then
    if [ "$2" = - ]; then jq -r "($1) // empty | if type == \"array\" then .[] else . end" 2>/dev/null
    else jq -r "($1) // empty | if type == \"array\" then .[] else . end" "$2" 2>/dev/null; fi
  elif command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs");
      const src = process.argv[2] === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(process.argv[2], "utf8");
      let v = JSON.parse(src);
      for (const k of process.argv[1].split(".").filter(Boolean)) v = v == null ? v : v[k];
      if (v != null) console.log(Array.isArray(v) ? v.join("\n") : String(v));
    ' "$1" "$2" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, sys
v = json.load(sys.stdin if sys.argv[2] == "-" else open(sys.argv[2]))
for k in [p for p in sys.argv[1].split(".") if p]:
    v = v.get(k) if isinstance(v, dict) else None
if v is not None:
    print("\n".join(map(str, v)) if isinstance(v, list) else v)
' "$1" "$2" 2>/dev/null
  fi
}

case "$mode" in
  session-start | stop)
    # Only swarm.json drives these hooks: a project that wires its own SessionStart/Stop hooks in
    # .claude/settings.json (and has no swarm.json) must not get them run twice.
    key=.hooks.sessionStart
    if [ "$mode" = stop ]; then key=.hooks.stop; fi
    if [ -f "$manifest" ]; then
      cmd=$(json "$key" "$manifest")
      [ -n "$cmd" ] && (cd "$root" && sh -c "$cmd")
    fi
    ;;
  post-edit)
    # The hook's JSON reaches the command on stdin (the edited file is tool_input.file_path); whatever the command prints
    # (a PostToolUse `additionalContext` JSON, or nothing) goes back to Claude Code. Its exit status is ignored.
    if [ -f "$manifest" ]; then
      cmd=$(json .hooks.postEdit "$manifest")
      [ -n "$cmd" ] && (cd "$root" && sh -c "$cmd")
    fi
    ;;
  gate)
    input=$(cat)
    file=$(printf '%s' "$input" | json .tool_input.file_path -)
    [ -z "$file" ] && exit 0
    patterns='*/vitest.config.*
*/jest.config.*
*/biome.json
*/.eslintrc*
*/eslint.config.*
*/architecture.test.*
*/docs.test.*
*/scripts/dev/land.*
*/scripts/dev/verify.*
*/quality-ratchets.json
*/.githooks/*
*/.github/workflows/*
*/swarm.json
*/.claude/settings.json'
    if [ -f "$manifest" ]; then
      extra=$(json .gates "$manifest")
      [ -n "$extra" ] && patterns="$patterns
$extra"
    fi
    matched=$(printf '%s\n' "$patterns" | while IFS= read -r p; do
      [ -z "$p" ] && continue
      # shellcheck disable=SC2254 # the pattern is a glob on purpose
      # "($p)": bash 3.2 (macOS /bin/sh) cannot parse an unopened case pattern inside $(...).
      case "$file" in
        ($p)
          echo "$p"
          break
          ;;
      esac
    done)
    if [ -n "$matched" ]; then
      action=
      [ -f "$manifest" ] && action=$(json .hooks.gateEdit "$manifest")
      case "$action" in
        block | ask)
          # deny: the edit does not happen and the agent sees the reason; ask: the person confirms this one edit.
          decision=ask
          [ "$action" = block ] && decision=deny
          esc=$(printf '%s' "$file" | sed 's/\\/\\\\/g; s/"/\\"/g')
          reason="swarm: $esc is a quality gate (hooks.gateEdit: $action in swarm.json). A person edits it, or approves the edit, and justifies it in the commit; never relax a gate to make something pass."
          printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$decision" "$reason"
          # The decision answers alone: a second JSON from hooks.preEdit on the same stdout would not parse.
          exit 0
          ;;
        *)
          echo "swarm: you are touching a quality gate ($file). Justify it in the commit; never relax it to make something pass." >&2
          ;;
      esac
    fi
    # hooks.preEdit gets the hook JSON on stdin; its stdout (PreToolUse additionalContext) goes back to Claude Code.
    # Only its exit 2 is passed on: any other failure must not block an edit.
    if [ -f "$manifest" ]; then
      cmd=$(json .hooks.preEdit "$manifest")
      if [ -n "$cmd" ]; then
        printf '%s' "$input" | (cd "$root" && sh -c "$cmd")
        [ $? -eq 2 ] && exit 2
      fi
    fi
    ;;
esac
exit 0
