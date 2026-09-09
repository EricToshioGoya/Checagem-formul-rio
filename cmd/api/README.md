# API de autorização

Controla quem pode abrir o aplicativo. Guarda os pedidos de acesso, avisa por
e-mail o responsável pelo painel e, uma vez aprovado, emite a credencial
assinada que o aparelho passa a apresentar.

**Não recebe dado de formulário.** Preenchimentos e fotos continuam
exclusivamente no aparelho, como antes.

## Como o acesso é concedido

1. O montador informa e-mail e painel na tela de abertura. O aplicativo envia
   o pedido junto com um identificador do aparelho.
2. O responsável daquele painel recebe um e-mail com dois links: **Aprovar** e
   **Negar**. Valem 48 horas e funcionam uma única vez.
3. Aprovado, o aplicativo recebe uma credencial assinada (ES256) com validade
   de 90 dias e a guarda no aparelho.
4. Dali em diante o aplicativo **abre offline**: a assinatura é conferida no
   próprio aparelho, com a chave pública embutida no build. Quando há rede, a
   credencial se renova sozinha — e é nesse momento que uma revogação chega.

A autorização vale para **aquele aparelho**. Digitar um e-mail já aprovado em
outro aparelho gera uma solicitação nova, e o responsável recebe outro aviso.
É o que impede alguém de entrar apenas sabendo o endereço de um colega.

### O responsável

Quem pede acesso com o e-mail cadastrado como responsável de um painel recebe
o link de confirmação **na própria caixa**: clicar nele prova a posse do
endereço. É assim que ele entra, e é por isso que o sistema não tem senha.
Com esse acesso ele ganha a tela **Autorizações**, onde decide vários pedidos
de uma vez e revoga acessos concedidos.

## Subir

```bash
# 1. Chave que assina as credenciais. Guarde a saída: a linha
#    VITE_AUTH_CHAVE_PUBLICA vai no build do aplicativo.
go run . -gerar-chave

# 2. Painéis e seus responsáveis
cp paineis.exemplo.json paineis.json && $EDITOR paineis.json

# 3. Servidor
go run .
```

Em produção, pela imagem:

```bash
docker build -t verificacao-api cmd/api
docker run -d -p 8090:8090 -v /srv/verificacao:/dados \
  -e URL_BASE=https://autorizacao.empresa.com.br \
  -e ORIGENS=https://verificacao.empresa.com.br \
  -e SMTP_HOST=smtp.empresa.com.br -e SMTP_DE=verificacao@empresa.com.br \
  verificacao-api
```

O `paineis.json` fica dentro do volume montado em `/dados`.

## Configuração

Tudo por variável de ambiente; nenhum segredo no código.

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORTA` | `8090` | Porta HTTP |
| `URL_BASE` | `http://localhost:<porta>` | Endereço público. **Entra nos links do e-mail** — em produção precisa ser o domínio publicado, ou o responsável clica num link que não abre |
| `ORIGENS` | *(vazio)* | Endereços do aplicativo autorizados a chamar a API, separados por vírgula. Vazio libera qualquer origem, e o servidor avisa no log |
| `DADOS` | `dados/autorizacoes.json` | Arquivo das solicitações |
| `CHAVE_PRIVADA` | `dados/chave-sessao.pem` | Chave que assina as credenciais |
| `PAINEIS` | `paineis.json` | Painéis e responsáveis |
| `VALIDADE_DIAS` | `90` | Quanto tempo a credencial vale offline |

### E-mail

Sem `SMTP_HOST`, o servidor sobe com o emissor de log: nada é enviado e a
mensagem inteira, com os links, aparece no log. Serve para exercitar o fluxo
enquanto o servidor de e-mail não está definido.

| Variável | Padrão | |
|---|---|---|
| `SMTP_HOST` | *(vazio)* | Definir liga o envio real |
| `SMTP_PORTA` | `587` | |
| `SMTP_USUARIO`, `SMTP_SENHA` | *(vazio)* | Omitir dispensa autenticação (relay interno) |
| `SMTP_DE` | — | Obrigatório com `SMTP_HOST` |
| `SMTP_DE_NOME` | `Verificação de Montagem de Painéis` | |
| `SMTP_SEM_TLS` | *(desligado)* | `1` desliga o STARTTLS. Só em relay interno sem credencial |

Trocar de transporte é implementar `email.Emissor` em `internal/email`.

## Ligar o aplicativo à API

No build do front:

```bash
VITE_API_URL=https://autorizacao.empresa.com.br \
VITE_AUTH_CHAVE_PUBLICA='{"kty":"EC","crv":"P-256","x":"…","y":"…"}' \
npm run build
```

Sem essas duas variáveis o aplicativo bloqueia e não consegue pedir acesso.
Para desenvolver sem subir a API, use `VITE_SEM_AUTORIZACAO=1` — o aplicativo
exibe uma faixa amarela permanente avisando que o build está sem proteção.

## Rotas

| Método | Rota | Quem chama |
|---|---|---|
| `GET` | `/api/saude` | Monitoração |
| `GET` | `/api/chave-publica` | Quem gera o build do aplicativo |
| `GET` | `/api/paineis` | Tela de abertura (sem o e-mail dos responsáveis) |
| `POST` | `/api/solicitacoes` | Aplicativo, ao pedir acesso |
| `GET` | `/api/solicitacoes/{id}?device=` | Aplicativo, enquanto espera a decisão |
| `GET` | `/api/decisao/aprovar?id=&t=` | Link no e-mail do responsável |
| `GET` | `/api/decisao/negar?id=&t=` | Link no e-mail do responsável |
| `POST` | `/api/sessao/revalidar` | Aplicativo, quando tem rede |
| `GET` | `/api/paineis/{id}/solicitacoes` | Tela de autorizações |
| `POST` | `/api/solicitacoes/{id}/decidir` | Tela de autorizações |
| `POST` | `/api/solicitacoes/{id}/revogar` | Tela de autorizações |

As três últimas exigem `Authorization: Bearer <credencial>` de um responsável
**daquele** painel — o servidor confere em cada chamada, não confia no
aplicativo.

## Decisões

**Arquivo JSON, não banco.** O volume é de uma tabela com algumas centenas de
linhas para uma equipe conhecida. A escrita é atômica (temporário + rename), e
`autorizacao.Repositorio` é o ponto de troca se isso mudar.

**Sem senha.** A identidade é o reconhecimento do responsável, que sabe quem
está na obra, somado à posse do aparelho. Uma senha a mais seria uma senha a
mais para vazar e recuperar.

**A credencial vale offline.** É o que permite trabalhar sem sinal, e o preço
é que uma revogação só alcança o aparelho quando ele reencontrar a rede.

**O segredo do link não é gravado.** O banco guarda apenas o SHA-256 dele, e
o campo é apagado na primeira decisão: um vazamento do arquivo não permite
aprovar nada.

## Testes

```bash
cd cmd/api && go test ./...
```

O fluxo completo no navegador real está em
`npm run fumaca-autorizacao`, na raiz do repositório.

## Limite conhecido

A credencial protege o **acesso à tela**. Os preenchimentos continuam no
IndexedDB do aparelho: quem estiver com o celular na mão alcança os dados
pelas ferramentas do navegador, sem passar pela autorização. Fechar isso exige
mover os dados para o servidor, decisão que ficou fora do escopo desta versão.
