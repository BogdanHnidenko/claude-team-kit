#!/usr/bin/env bash
# Claude Team Kit installer — installs the team globally into ~/.claude
# so it works in every project. Safe to re-run (updates in place).
#
#   bash install.sh          copy files
#   bash install.sh --link   symlink files (edit the kit repo → changes apply everywhere)
#   bash install.sh --no-adapt   не ставити команди й скіли для Gemini (agy) і Codex
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_HOME:-$HOME/.claude}"
MODE="copy"
ADAPT=1
for arg in "$@"; do
  case "$arg" in
    --link) MODE="link" ;;
    --no-adapt) ADAPT=0 ;;
  esac
done
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
# файли, яких у наборі вже немає (у режимі copy вони лишились би в ~/.claude)
for old in agents/team-qa-ext.md commands/qa-provider.md commands/audit.md; do
  { [ -e "$DEST/$old" ] || [ -L "$DEST/$old" ]; } && { rm -f "$DEST/$old"; echo "  removed stale $old"; } || true
done
# прибрано профілі DeepSeek/Kimi: файл підключення й рядок у rc (ключі в providers.env не чіпаємо)
if [ -e "$DEST/team-kit-profiles.sh" ] || [ -L "$DEST/team-kit-profiles.sh" ]; then
  rm -f "$DEST/team-kit-profiles.sh"; echo "  removed team-kit-profiles.sh (DeepSeek/Kimi більше не підтримуються)"
  for rc in "${ZDOTDIR:-$HOME}/.zshrc" "$HOME/.bashrc"; do
    if [ -f "$rc" ] && grep -q 'team-kit-profiles.sh' "$rc"; then
      cp "$rc" "$rc.bak.$STAMP"; grep -v 'team-kit-profiles.sh' "$rc.bak.$STAMP" > "$rc" || true; echo "  $rc: рядок профілів прибрано (копія: $rc.bak.$STAMP)"
    fi
  done
  [ -f "$DEST/providers.env" ] && echo "  ⚠ $DEST/providers.env з ключами лишився: видали його й відклич ключ DeepSeek, якщо вони більше не потрібні" || true
fi
for f in "$KIT"/agents/*.md;   do place "$f" "$DEST/agents/$(basename "$f")";   echo "  agent    $(basename "$f" .md)"; done
for f in "$KIT"/commands/*.md; do place "$f" "$DEST/commands/$(basename "$f")"; echo "  command  /$(basename "$f" .md)"; done
mkdir -p "$DEST/skills"
for d in "$KIT"/skills/*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  touch "$d/.team-kit" 2>/dev/null || true
  place "${d%/}" "$DEST/skills/$name"; echo "  skill    $name"
done
place "$KIT/pipeline" "$DEST/pipeline"
echo "  helper   $DEST/pipeline/pipeline.mjs"

node "$DEST/pipeline/pipeline.mjs" install-hook "$DEST/settings.json" "$DEST/pipeline/pipeline.mjs"
node "$DEST/pipeline/pipeline.mjs" install-memory "$DEST/CLAUDE.md"

# Команди й скіли набору для Gemini (agy) і Codex: ті самі /feature, /fix, /pretest… (ставляться, якщо ці CLI знайдено)
if [ "$ADAPT" = "1" ]; then
  node "$DEST/pipeline/pipeline.mjs" adapt --host auto || echo "  ⚠ adapt не вдався: node ~/.claude/pipeline/pipeline.mjs adapt"
fi

cat <<EOF

✔ Done. In any project (Claude Code, Gemini agy or Codex: the same commands):
  1. cd <workspace root>  &&  claude   (or agy / codex)
  2. /pipeline-init   (scans everything; or /pipeline-init-web, /pipeline-init-mobile)
  3. /feature <what to build>      /pretest — the Pretester alone
  Gemini / Codex: node ~/.claude/pipeline/pipeline.mjs setup   (CLI, permissions, model names)

Check the install anytime:  node ~/.claude/pipeline/pipeline.mjs doctor
EOF
