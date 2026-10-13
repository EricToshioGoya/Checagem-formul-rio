#!/usr/bin/env bash
# Sobe o aplicativo no GitHub Codespaces: o servidor de acesso, que serve
# também o dist/ compilado, na porta 3001. O Codespaces encaminha a porta e
# abre o endereço no navegador.
#
#   bash scripts/codespace.sh               sobe, se ainda não estiver no ar
#   bash scripts/codespace.sh --recompilar  para, reinstala, recompila e sobe
#                                           (depois de um git pull)
set -euo pipefail
cd "$(dirname "$0")/.."

PORTA=3001
PID=/tmp/verificacao-servidor.pid
LOG=/tmp/verificacao-servidor.log

no_ar() { curl -fs -o /dev/null "http://localhost:$PORTA/"; }

parar() {
  if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then
    kill "$(cat "$PID")"
    for _ in $(seq 1 10); do no_ar || break; sleep 1; done
  fi
  rm -f "$PID"
}

if [ "${1:-}" = "--recompilar" ]; then
  parar
  npm ci
  npm run build
elif no_ar; then
  echo "O aplicativo já está no ar na porta $PORTA."
  exit 0
fi

[ -d node_modules ] || npm ci
[ -f dist/index.html ] || npm run build

# Atrás do proxy do Codespaces, o https e o endereço do cliente chegam nos
# cabeçalhos X-Forwarded-*.
export CONFIAR_PROXY="${CONFIAR_PROXY:-1}"
# Um processo só (sem o npx no meio): parar pelo PID não deixa órfão.
nohup node --import tsx servidor/src/index.ts > "$LOG" 2>&1 < /dev/null &
echo $! > "$PID"

for _ in $(seq 1 60); do
  if no_ar; then
    echo "Aplicativo no ar na porta $PORTA (log em $LOG)."
    exit 0
  fi
  sleep 1
done
echo "O servidor não respondeu na porta $PORTA. Veja o log em $LOG:" >&2
tail -n 20 "$LOG" >&2
exit 1
