#!/usr/bin/env bash
# Removes Claude Team Kit from ~/.claude. Project files (.pipeline/, specs) are not touched.
set -euo pipefail
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_HOME:-$HOME/.claude}"

[ -f "$DEST/pipeline/pipeline.mjs" ] && node "$DEST/pipeline/pipeline.mjs" uninstall-hook "$DEST/settings.json" || true
for f in "$KIT"/agents/*.md;   do rm -f "$DEST/agents/$(basename "$f")"; done
for f in "$KIT"/commands/*.md; do rm -f "$DEST/commands/$(basename "$f")"; done
rm -rf "$DEST/pipeline"
echo "✔ Claude Team Kit removed from $DEST"
