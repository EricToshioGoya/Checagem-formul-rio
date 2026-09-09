# Imagem da API de autorização. Binário estático em imagem mínima: nada além
# do executável, os certificados raiz (para o STARTTLS do SMTP) e os dados.
FROM golang:1.24-alpine AS compilacao
WORKDIR /origem
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /api .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 10001 api \
    && mkdir -p /dados && chown api:api /dados
COPY --from=compilacao /api /usr/local/bin/api
USER api

# /dados guarda as solicitações e a chave de sessão: monte um volume aqui,
# ou toda credencial em circulação morre no próximo deploy.
VOLUME ["/dados"]
ENV PORTA=8090 \
    DADOS=/dados/autorizacoes.json \
    CHAVE_PRIVADA=/dados/chave-sessao.pem \
    PAINEIS=/dados/paineis.json
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget -qO- http://localhost:8090/api/saude || exit 1

ENTRYPOINT ["api"]
