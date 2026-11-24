# Claude Team Kit: профілі запуску Claude Code на інших провайдерах. Підключається в ~/.zshrc (bash install.sh --profiles).
# Звичайний `claude` (підписка Anthropic) не змінюється: кожен профіль працює в підоболонці, змінні не «протікають» у термінал.
# Ключі лише в ~/.claude/providers.env (chmod 600).
#
#   claude-ds       DeepSeek, повна заміна Claude (opus=v4-pro, sonnet=v4-pro, haiku=flash)
#   claude-ds-fast  DeepSeek економ (sonnet і haiku = flash): рутина S/M
#   claude-kimi     Kimi K3 (контекст 1M)
#   claude-free     локальний роутер freellmapi / LiteLLM / claude-code-router (експериментально)
# Після вичерпання ліміту Claude: у новому терміналі `claude-ds`, потім /resume <task-id> (НЕ `claude --resume`: чужий формат чату).

# Файл з ключами (можна перевизначити змінною TEAM_KIT_PROVIDERS_ENV)
_tk_envfile() { printf '%s' "${TEAM_KIT_PROVIDERS_ENV:-$HOME/.claude/providers.env}"; }

# _tk_launch <назва> <base_url> <змінна_з_ключем> <opus> <sonnet> <haiku> <головна_модель> [аргументи claude…]
# Усі чотири моделі задаються обовʼязково: інакше сабагенти запитають нативну назву Anthropic і впадуть (model not found).
_tk_launch() {
  local name="$1" base="$2" keyvar="$3" m_opus="$4" m_sonnet="$5" m_haiku="$6" m_main="$7"; shift 7
  local envfile; envfile="$(_tk_envfile)"
  [ -f "$envfile" ] || { echo "✖ немає $envfile. Запусти: bash install.sh --profiles" >&2; return 1; }
  local key
  key="$( set -a; . "$envfile" >/dev/null 2>&1; eval "printf '%s' \"\${$keyvar:-}\"" )"
  [ -n "$key" ] || { echo "✖ у $envfile не заповнено $keyvar. Запусти: bash install.sh --profiles" >&2; return 1; }
  (
    unset ANTHROPIC_API_KEY                        # інакше конфлікт авторизації (401)
    export ANTHROPIC_BASE_URL="$base"
    export ANTHROPIC_AUTH_TOKEN="$key"
    export ANTHROPIC_MODEL="$m_main"
    export ANTHROPIC_DEFAULT_OPUS_MODEL="$m_opus"
    export ANTHROPIC_DEFAULT_SONNET_MODEL="$m_sonnet"
    export ANTHROPIC_DEFAULT_HAIKU_MODEL="$m_haiku"
    export TEAM_KIT_NO_VISION=1                    # текстовий провайдер: тестування зі скріншотами піде через team-qa-ext
    export TEAM_KIT_PROVIDER="$name"
    command claude "$@"
  )
}

claude-ds()      { _tk_launch deepseek      "https://api.deepseek.com/anthropic" DEEPSEEK_API_KEY deepseek-v4-pro deepseek-v4-pro deepseek-flash deepseek-v4-pro "$@"; }
claude-ds-fast() { _tk_launch deepseek-fast "https://api.deepseek.com/anthropic" DEEPSEEK_API_KEY deepseek-v4-pro deepseek-flash  deepseek-flash deepseek-flash  "$@"; }
claude-kimi()    { _tk_launch kimi          "https://api.moonshot.ai/anthropic"  KIMI_API_KEY     'kimi-k3[1m]'   'kimi-k3[1m]'   'kimi-k3[1m]'  'kimi-k3[1m]'   "$@"; }
claude-free() {
  local envfile base model; envfile="$(_tk_envfile)"
  base="$( set -a; . "$envfile" >/dev/null 2>&1; printf '%s' "${FREELLM_BASE_URL:-http://localhost:3001}" )"
  model="$( set -a; . "$envfile" >/dev/null 2>&1; printf '%s' "${FREELLM_MODEL:-auto}" )"
  _tk_launch free "$base" FREELLM_API_KEY "$model" "$model" "$model" "$model" "$@"
}

# Короткі команди (щоб не писати node ~/.claude/pipeline/pipeline.mjs):
#   pl <команда>      те саме, що node ~/.claude/pipeline/pipeline.mjs <команда>   (наприклад: pl status, pl duo)
#   use-ds            цей проєкт працює через DeepSeek (панель VS Code теж), потім Reload Window і НОВИЙ чат
#   use-ds-fast       те саме, економний режим
#   use-claude        повернути звичайний Claude для цього проєкту
pl()            { node "$HOME/.claude/pipeline/pipeline.mjs" "$@"; }
use-ds()        { pl provider ds; }
use-ds-fast()   { pl provider ds-fast; }
use-kimi()      { pl provider kimi; }
use-claude()    { pl provider claude; }
