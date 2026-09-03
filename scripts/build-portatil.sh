#!/usr/bin/env bash
# Gera o binário portátil da modalidade B com a aplicação embutida.
#
# Uso:  scripts/build-portatil.sh [sistema/arquitetura ...]
# Ex.:  scripts/build-portatil.sh windows/amd64 linux/amd64 darwin/arm64
set -euo pipefail

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$raiz"

alvos=("$@")
if [ ${#alvos[@]} -eq 0 ]; then
  alvos=("windows/amd64")
fi

echo "==> Gerando a aplicação (vite build)"
npm run build

echo "==> Copiando dist/ para cmd/servidor/web/"
rm -rf cmd/servidor/web
cp -r dist cmd/servidor/web
# O .gitkeep mantém web/ existindo no repositório: sem ele a diretiva
# //go:embed all:web não compila em um clone recém-feito.
touch cmd/servidor/web/.gitkeep

saida="$raiz/portatil"
mkdir -p "$saida"

for alvo in "${alvos[@]}"; do
  sistema="${alvo%%/*}"
  arquitetura="${alvo##*/}"
  nome="verificacao-montagem-${sistema}-${arquitetura}"
  [ "$sistema" = "windows" ] && nome="${nome}.exe"
  echo "==> Compilando $nome"
  (cd cmd/servidor && GOOS="$sistema" GOARCH="$arquitetura" CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o "$saida/$nome" .)
done

echo
echo "Binários em: $saida"
ls -lh "$saida"
