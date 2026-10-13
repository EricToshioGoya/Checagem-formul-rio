#!/usr/bin/env bash
# Verificação do servidor portátil (modalidade B): rotas, travessia de
# caminho e cabeçalhos. Exige Go e um dist/ já gerado.
#
#   npm run build && scripts/testes/08-servidor-portatil.sh
set -uo pipefail

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$raiz"
porta="${PORTA:-8123}"
passou=0; falhou=0
ok()    { echo "  PASS  $1${2:+ — $2}"; passou=$((passou+1)); }
falha() { echo "  FAIL  $1${2:+ — $2}"; falhou=$((falhou+1)); }
checa() { if [ "$1" = "1" ]; then ok "$2" "${3:-}"; else falha "$2" "${3:-}"; fi }

echo
echo "=== 08. SERVIDOR PORTÁTIL (modalidade B) ==="
[ -f dist/index.html ] || { echo "  dist/ ausente: rode 'npm run build' antes."; exit 1; }

binario="$(mktemp -d)/servidor"
rm -rf cmd/servidor/web && cp -r dist cmd/servidor/web && touch cmd/servidor/web/.gitkeep
(cd cmd/servidor && GOFLAGS=-mod=mod go build -o "$binario" .) || { echo "  falha ao compilar"; exit 1; }
ok "08.1 o servidor compila"

"$binario" -porta "$porta" -sem-navegador >/dev/null 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null' EXIT
sleep 2

codigo() { curl -s -o /dev/null -w '%{http_code}' --path-as-is "http://127.0.0.1:$porta$1"; }
corpo()  { curl -s --path-as-is "http://127.0.0.1:$porta$1"; }

checa "$([ "$(codigo /)" = 200 ] && echo 1 || echo 0)" "08.2 serve a aplicação na raiz"
checa "$([ "$(codigo /rota/inexistente)" = 200 ] && echo 1 || echo 0)" "08.3 rota desconhecida cai no index.html"

vazou=0
for caminho in "/../../../etc/passwd" "/..%2f..%2f..%2fetc%2fpasswd" "/web/../../../etc/passwd"; do
  corpo "$caminho" | grep -q "root:x:" && vazou=1
done
printf 'GET /../../../../etc/passwd HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n' \
  | timeout 5 nc 127.0.0.1 "$porta" 2>/dev/null | grep -q "root:x:" && vazou=1
checa "$([ $vazou -eq 0 ] && echo 1 || echo 0)" "08.4 não serve arquivos fora da pasta da aplicação"

curl -sI "http://127.0.0.1:$porta/sw.js" | grep -qi "Service-Worker-Allowed: /" \
  && ok "08.5 sw.js recebe Service-Worker-Allowed" || falha "08.5 sw.js recebe Service-Worker-Allowed"

cabecalhos="$(curl -sI "http://127.0.0.1:$porta/")"
faltando=""
for h in "Content-Security-Policy" "X-Content-Type-Options" "X-Frame-Options" "Referrer-Policy"; do
  echo "$cabecalhos" | grep -qi "^$h:" || faltando="$faltando $h"
done
checa "$([ -z "$faltando" ] && echo 1 || echo 0)" "08.6 envia cabeçalhos de segurança" "ausentes:$faltando"

hostEstranho="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: painel.exemplo.com' "http://127.0.0.1:$porta/")"
checa "$([ "$hostEstranho" != 200 ] && echo 1 || echo 0)" \
  "08.7 recusa requisição com Host de outro domínio (DNS rebinding)" \
  "respondeu HTTP $hostEstranho para Host: painel.exemplo.com"

kill $pid 2>/dev/null
echo
echo "== 08 $passou PASS / $falhou FAIL =="
[ $falhou -eq 0 ]
