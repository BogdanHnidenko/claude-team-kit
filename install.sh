#!/usr/bin/env bash
# Claude Team Kit installer — installs the team globally into ~/.claude
# so it works in every project. Safe to re-run (updates in place).
#
#   bash install.sh          copy files
#   bash install.sh --link   symlink files (edit the kit repo → changes apply everywhere)
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_HOME:-$HOME/.claude}"
MODE="copy"
[ "${1:-}" = "--link" ] && MODE="link"
STAMP="$(date +%s)"

command -v node >/dev/null 2>&1 || { echo "✖ Node.js >= 18 is required"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || { echo "✖ Node.js >= 18 is required (found $(node -v))"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "✖ git is required"; exit 1; }

mkdir -p "$DEST/agents" "$DEST/commands"

place() { # place <src> <dst>: backs up a different, non-kit file before replacing it
  local src="$1" dst="$2"
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    if [ -d "$dst" ]; then
      [ -f "$dst/.team-kit" ] || mv "$dst" "$dst.bak.$STAMP"
    elif ! cmp -s "$src" "$dst"; then
      cp "$dst" "$dst.bak.$STAMP"; echo "  backup: $dst.bak.$STAMP"
    fi
  fi
  rm -rf "$dst"
  if [ "$MODE" = "link" ]; then ln -s "$src" "$dst"; else cp -R "$src" "$dst"; fi
}

echo "Installing Claude Team Kit into $DEST ($MODE)"
touch "$KIT/pipeline/.team-kit" 2>/dev/null || true
# remove links/copies of files that no longer exist in the kit (renamed commands etc.)
for d in agents commands; do
  for f in "$DEST/$d"/*.md; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    if [ -L "$f" ] && [ ! -e "$f" ]; then
      case "$(readlink "$f")" in "$KIT"/*) rm -f "$f"; echo "  removed stale $d/$(basename "$f")";; esac
    fi
  done
done
for legacy in pipeline-init.md; do
  f="$DEST/commands/$legacy"
  if [ -f "$f" ] && [ ! -e "$KIT/commands/$legacy" ] && grep -q "team pipeline" "$f"; then rm -f "$f"; echo "  removed old command /${legacy%.md}"; fi
done
for f in "$KIT"/agents/*.md;   do place "$f" "$DEST/agents/$(basename "$f")";   echo "  agent    $(basename "$f" .md)"; done
for f in "$KIT"/commands/*.md; do place "$f" "$DEST/commands/$(basename "$f")"; echo "  command  /$(basename "$f" .md)"; done
place "$KIT/pipeline" "$DEST/pipeline"
echo "  helper   $DEST/pipeline/pipeline.mjs"

node "$DEST/pipeline/pipeline.mjs" install-hook "$DEST/settings.json" "$DEST/pipeline/pipeline.mjs"
node "$DEST/pipeline/pipeline.mjs" install-memory "$DEST/CLAUDE.md"

cat <<EOF

✔ Done. In any project:
  1. cd <workspace root>  &&  claude
  2. /pipeline-init-web  or  /pipeline-init-mobile   (both, for web + mobile)
  3. /feature <what to build>

Check the install anytime:  node ~/.claude/pipeline/pipeline.mjs doctor
EOF
