#!/bin/sh
# Swarm Protocol plugin hooks. Contract: INTEGRATION.md §3.
# Usage: swarm-hook.sh session-start | stop | gate
# A hook never blocks a session: every path exits 0.

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
  gate)
    file=$(json .tool_input.file_path -)
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
*/.githooks/*
*/.github/workflows/*
*/swarm.json
*/.claude/settings.json'
    if [ -f "$manifest" ]; then
      extra=$(json .gates "$manifest")
      [ -n "$extra" ] && patterns="$patterns
$extra"
    fi
    printf '%s\n' "$patterns" | while IFS= read -r p; do
      [ -z "$p" ] && continue
      # shellcheck disable=SC2254 # the pattern is a glob on purpose
      case "$file" in
        $p)
          echo "swarm: you are touching a quality gate ($file). Justify it in the commit; never relax it to make something pass." >&2
          break
          ;;
      esac
    done
    ;;
esac
exit 0
