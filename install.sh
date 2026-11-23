#!/usr/bin/env bash
# Claude Team Kit installer — installs the team globally into ~/.claude
# so it works in every project. Safe to re-run (updates in place).
#
#   bash install.sh          copy files
#   bash install.sh --link   symlink files (edit the kit repo → changes apply everywhere)
#   bash install.sh --profiles   лише профілі інших провайдерів (claude-ds, claude-kimi…) і ключ DeepSeek/Kimi
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_HOME:-$HOME/.claude}"
MODE="copy"
PROFILES_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --link) MODE="link" ;;
    --profiles) PROFILES_ONLY=1 ;;
  esac
done
STAMP="$(date +%s)"

# ---- профілі інших провайдерів: файл ключів (chmod 600), прихований ввід, перевірка ключа, підключення в ~/.zshrc
set_env_value() { # set_env_value <файл> <КЛЮЧ> <значення>: замінює рядок або додає, значення не потрапляє в аргументи інших команд
  local f="$1" k="$2" v="$3" tmp
  tmp="$(mktemp)"
  K="$k" V="$v" awk 'BEGIN{FS=OFS="="; done=0} $1==ENVIRON["K"] {print ENVIRON["K"] "=" ENVIRON["V"]; done=1; next} {print} END{if(!done) print ENVIRON["K"] "=" ENVIRON["V"]}' "$f" > "$tmp"
  cat "$tmp" > "$f"; rm -f "$tmp"; chmod 600 "$f"
}
get_env_value() { local f="$1" k="$2"; ( set -a; . "$f" >/dev/null 2>&1; eval "printf '%s' \"\${$k:-}\"" ); }
check_key() { # check_key <base_url> <model> <ключ>: 200 = ключ робочий, 401/403 = хибний. Ключ іде через stdin, не в списку процесів
  command -v curl >/dev/null 2>&1 || { echo skip; return; }
  local code
  code="$(printf 'header = "x-api-key: %s"\nheader = "authorization: Bearer %s"\n' "$3" "$3" | curl -s -o /dev/null -m 25 -w '%{http_code}' -K - \
    -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
    -d "{\"model\":\"$2\",\"max_tokens\":1,\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}" "$1/v1/messages" 2>/dev/null || echo 000)"
  echo "$code"
}
profiles_setup() {
  local envfile="$DEST/providers.env" prof="$DEST/team-kit-profiles.sh" rc line
  mkdir -p "$DEST"
  if [ "$MODE" = "link" ]; then rm -f "$prof"; ln -s "$KIT/scripts/claude-profiles.sh" "$prof"; else cp "$KIT/scripts/claude-profiles.sh" "$prof"; fi
  [ -f "$envfile" ] || cp "$KIT/scripts/providers.env.example" "$envfile"
  chmod 600 "$envfile"
  echo "Профілі провайдерів: $prof"
  echo "Ключі: $envfile (права 600, не в git)"
  local entry name var base model val key code
  for entry in "DeepSeek|DEEPSEEK_API_KEY|https://api.deepseek.com/anthropic|deepseek-flash" "Kimi|KIMI_API_KEY|https://api.moonshot.ai/anthropic|kimi-k3[1m]"; do
    IFS='|' read -r name var base model <<<"$entry"
    val="$(get_env_value "$envfile" "$var")"
    key="${!var:-}"                      # ключ можна передати змінною оточення: DEEPSEEK_API_KEY=… bash install.sh --profiles
    if [ -z "$key" ] && [ -t 0 ] && [ -t 1 ]; then
      if [ -n "$val" ]; then read -r -p "$name: ключ уже збережено. Замінити? [y/N] " ANS || ANS=""; case "$ANS" in y|Y) ;; *) continue ;; esac; fi
      read -r -s -p "$name API key (вставка не відображається; Enter = пропустити): " key || key=""; echo
    fi
    [ -n "$key" ] || { [ -n "$val" ] && echo "  $name: ключ уже є" || echo "  $name: пропущено"; continue; }
    set_env_value "$envfile" "$var" "$key"
    code="$(check_key "$base" "$model" "$key")"
    case "$code" in
      200) echo "  ✔ $name: ключ збережено й працює" ;;
      401|403) echo "  ✖ $name: ключ збережено, але провайдер його відхилив (HTTP $code). Перевір ключ і запусти ще раз" ;;
      skip) echo "  ✔ $name: ключ збережено (curl немає, перевірку пропущено)" ;;
      *) echo "  ⚠ $name: ключ збережено, перевірка не вдалась (HTTP $code: мережа чи ліміт). Спробуй claude-ds" ;;
    esac
    key=""
  done
  case "${SHELL:-}" in */zsh) rc="${ZDOTDIR:-$HOME}/.zshrc" ;; */bash) rc="$HOME/.bashrc" ;; *) rc="${ZDOTDIR:-$HOME}/.zshrc" ;; esac
  line='[ -f "$HOME/.claude/team-kit-profiles.sh" ] && . "$HOME/.claude/team-kit-profiles.sh"  # Claude Team Kit: claude-ds, claude-kimi…'
  if [ -f "$rc" ] && grep -q 'team-kit-profiles.sh' "$rc"; then echo "  $rc: уже підключено"
  else printf '\n%s\n' "$line" >> "$rc"; echo "  $rc: підключено"; fi
  echo
  echo "Готово. Відкрий НОВИЙ термінал (або: source $rc) і запускай:"
  echo "  claude-ds        DeepSeek, повна заміна Claude"
  echo "  claude-ds-fast   DeepSeek економ (рутинні задачі)"
  echo "Звичайний claude лишається на підписці Anthropic. Після ліміту: claude-ds, потім /resume <id> (не claude --resume)."
}
if [ "$PROFILES_ONLY" = "1" ]; then profiles_setup; exit 0; fi

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

# Необов'язково: тестувальник на іншому ШІ (Gemini / ChatGPT) — лише в інтерактивному терміналі
if [ -t 0 ] && [ -t 1 ] && [ -z "${CI:-}" ] && [ -z "${KIT_NO_PROMPT:-}" ]; then
  echo
  read -r -p "Налаштувати тестувальника на Gemini/ChatGPT замість Claude (економить токени Claude)? [y/N] " ANS || ANS=""
  case "$ANS" in
    y|Y|yes|так|т) node "$DEST/pipeline/pipeline.mjs" qa-setup || true ;;
    *) echo "  Пізніше: node ~/.claude/pipeline/pipeline.mjs qa-setup  (або /qa-provider в Claude Code)" ;;
  esac
fi

cat <<EOF

✔ Done. In any project:
  1. cd <workspace root>  &&  claude
  2. /pipeline-init   (scans everything; or /pipeline-init-web, /pipeline-init-mobile)
  3. /feature <what to build>
  Tester on Gemini/ChatGPT:  /qa-provider   (or: node ~/.claude/pipeline/pipeline.mjs qa-setup)
  DeepSeek/Kimi when the Claude limit ends:  bash install.sh --profiles   (key goes into a hidden prompt)

Check the install anytime:  node ~/.claude/pipeline/pipeline.mjs doctor
EOF
