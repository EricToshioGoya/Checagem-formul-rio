#!/usr/bin/env bash
# Sobe o aplicativo no GitHub Codespaces: o servidor de acesso, que serve
# também o dist/ compilado, na porta 3001. O Codespaces encaminha a porta e
# abre o endereço no navegador.
#
#   bash scripts/codespace.sh               sobe; depois de um git pull, reinstala,
#                                           recompila e reinicia só o que mudou
#   bash scripts/codespace.sh --recompilar  refaz tudo, mesmo sem mudança
#
# Credenciais e configuração da máquina (SMTP_*, AVISO_WEBHOOK_URL…) ficam em
# servidor/.env, fora do Git, ou nos segredos do Codespaces. O servidor lê os
# dois sozinho; ver servidor/.env.exemplo.
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

# Verdadeiro se a referência $1 não existe ou se algo em $2… é mais novo que ela.
mudou_desde() {
  local referencia=$1
  shift
  [ -e "$referencia" ] || return 0
  [ -n "$(find "$@" -newer "$referencia" -type f -print -quit 2>/dev/null)" ]
}

FORCAR=0
[ "${1:-}" = "--recompilar" ] && FORCAR=1

INSTALAR=0
COMPILAR=0
REINICIAR=0
if [ "$FORCAR" = 1 ] || [ ! -d node_modules ] || mudou_desde node_modules/.package-lock.json package-lock.json; then
  INSTALAR=1
fi
# As mesmas pastas que a tela Sistema confere em "Aplicativo compilado e atualizado".
if [ "$INSTALAR" = 1 ] || mudou_desde dist/index.html src public compartilhado index.html vite.config.ts; then
  COMPILAR=1
fi
# Código do servidor ou configuração novos desde que ele subiu. servidor/dados
# fica de fora: o banco e os backups mudam o tempo todo.
if [ "$COMPILAR" = 1 ] || mudou_desde "$PID" servidor/src servidor/sementes servidor/.env compartilhado; then
  REINICIAR=1
fi

if no_ar && [ "$REINICIAR" = 0 ]; then
  echo "O aplicativo já está no ar na porta $PORTA, em dia com o código."
  exit 0
fi

parar
if [ "$INSTALAR" = 1 ]; then npm ci; fi
if [ "$COMPILAR" = 1 ]; then npm run build; fi

# Um processo só (sem o npx no meio): parar pelo PID não deixa órfão. HTTPS
# (proxy do GitHub) e o endereço público o servidor reconhece sozinho no Codespaces.
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
