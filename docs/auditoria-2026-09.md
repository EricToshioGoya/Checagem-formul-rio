# Auditoria do sistema — setembro de 2026

Verificação completa da v1 do Sistema de Verificação de Montagem de Painéis:
teste de todas as funcionalidades em navegador real, busca de inconsistências e
vulnerabilidades, e análise do sistema como produto de registro de qualidade.

**Como reproduzir:** `scripts/testes/` — ver `scripts/testes/README.md`.
Cada item abaixo cita a verificação que o demonstra.

**Resultado do levantamento:** 49 verificações passaram, 26 falharam. Nenhuma
funcionalidade prevista está ausente ou inoperante; todos os defeitos são de
comportamento em situação de contorno — e três deles causam perda silenciosa de
registro.

**Situação depois das correções:** 66 verificações passam, 11 falham. Os seis
itens da lista "antes de publicar" (seção 6) estão corrigidos e marcados
**Corrigido** ao longo do texto. O que resta é a lista "antes da próxima
revisão de protocolo" e as inconsistências menores, ainda em aberto.

| | Levantamento | Agora |
|---|---|---|
| Verificações que passam | 49 | 66 |
| Verificações que falham | 26 | 11 |
| Blocos sem nenhuma falha | 1 de 9 | 3 de 9 |

---

## 1. O que foi testado e está funcionando

| Área | Situação |
|---|---|
| Cadastro de projeto, validações obrigatórias, TAGs (criar, renomear, remover) | OK |
| Os oito tipos de campo (`check`, `check_com_foto`, `foto`, `numero`, `texto`, `selecao`, `anexo_pdf`, `grade_numerica`) | OK |
| Cabeçalho por TAG (texto, número, seleção, data) | OK |
| Compressão de imagem (4 MB → ~250 KB, JPEG, orientação EXIF) e limite de 4 fotos | OK |
| Progresso, filtros, índice de etapas, modal de apoio com aviso de arquivo ausente | OK |
| Geração de PDF nas duas opções de foto, um arquivo por tipo de verificação | OK |
| Exportar / importar / excluir projeto, com exclusão em cascata | OK |
| Administração: senha, edição, ativar/desativar, reordenar, exportar/importar JSON, restaurar original | OK |
| **Operação offline completa** — abre, preenche e gera PDF sem rede | OK |
| Escape de conteúdo (React), normalização de nome de arquivo, rotas inválidas | OK |
| Servidor portátil: sem travessia de caminho, escuta só em `127.0.0.1` | OK |
| `npm audit`: 0 vulnerabilidades nas dependências de produção | OK |

A arquitetura corresponde ao que o README descreve. A separação
`core` / `features` / `shared` é respeitada, nenhuma tela importa Dexie
diretamente, e o motor de formulários de fato não conhece formulário algum.

---

## 2. Defeitos críticos — perda de registro ou indisponibilidade

### 2.1 Backup adulterado derruba a aplicação em definitivo — **Corrigido**

`src/core/export/backupProjeto.ts:100`

`importarProjeto` faz `JSON.parse(...) as Pacote` e grava direto no banco. Não
há validação — enquanto todo formulário passa pelo Zod, o pacote de projeto não
passa por nada.

Um `projeto.json` com `empresa` como objeto (arquivo corrompido na transferência
por pendrive, ou adulterado de propósito) é gravado, quebra a renderização
(React error #31) e, como o registro fica no IndexedDB, **a aplicação abre em
tela branca a cada nova abertura**. Não há Error Boundary e não há caminho de
recuperação pela interface: só limpando os dados do site — o que apaga todos os
projetos do aparelho.

> Verificações 04.1, 04.3 e 04.4.

**Correção aplicada:** `core/export/pacoteSchema.ts` valida a estrutura inteira
antes da primeira escrita, com mensagem em português; a gravação virou uma
transação única sobre as quatro tabelas; e `app/LimiteDeErro.tsx` substitui a
tela em branco por uma tela com o erro, a opção de tentar de novo e, no caso
extremo, apagar os dados do aparelho de forma explícita e confirmada.

### 2.2 O arquivo escolhe a chave primária do projeto — **Corrigido**

`src/core/export/backupProjeto.ts:106`

`db.projetos.add({ ...pacote.projeto })` repassa o objeto inteiro. Se ele
contiver `id`, o Dexie usa esse valor como chave em vez de gerar uma. Um pacote
com `id: 999` grava o projeto com o id 999.

> Verificação 04.2.

**Correção aplicada:** o projeto passa a ser montado campo a campo, como já era
feito para tags, preenchimentos e mídias.

### 2.3 A última alteração se perde ao sair da tela — **Corrigido**

`src/shared/hooks/useSalvamentoAutomatico.ts:49`

O salvamento tem 500 ms de espera e a limpeza do efeito só faz `clearTimeout` —
nunca descarrega o que está pendente. `Preenchimento.sair()` descarrega, mas só
cobre o botão de voltar da própria tela.

Na prática: marcar uma etapa e recarregar, ou digitar uma observação e usar o
gesto de voltar do Android, **descarta o registro sem aviso**. A barra chega a
mostrar "Salvo".

> Verificações 02.1 e 02.2.

**Correção aplicada:** o hook grava o que está pendente em `visibilitychange`,
`pagehide` e ao desmontar, e deixa de descartar o valor quando a gravação falha.
Resposta dada com um toque — confirmação, seleção, foto, anexo — vai para o
banco na hora, sem esperar: a janela entre o toque e o registro caiu de 500 ms
para cerca de 60 ms, que é a latência do próprio IndexedDB. A espera de 500 ms
da especificação fica para os campos que se digitam.

### 2.4 Duas telas abertas apagam o trabalho uma da outra — **Corrigido**

`src/core/db/repositorios/preenchimentoRepository.ts:60`

`substituirRespostas` grava o mapa inteiro a partir do estado em memória da
tela. Duas telas do mesmo formulário — duas abas, ou o aplicativo reaberto sem
que a instância anterior tenha sido descarregada — fazem a última gravação
apagar o que a outra registrou.

No teste, uma etapa marcada na primeira tela **desapareceu** quando a segunda
gravou.

> Verificação 02.3.

**Correção aplicada:** `salvarRespostas` grava só as etapas tocadas, lendo o
registro atual dentro da transação; `salvarCabecalho` passa a mesclar pelo mesmo
motivo. A tela continua com a própria cópia em memória, então ela não mostra o
que a outra tela gravou até ser reaberta — mas o registro não se perde mais.

### 2.5 Vírgula decimal vira erro de fator dez — **Corrigido**

`src/shared/componentes/Campos.tsx:127` e `src/features/fill/campos/registro.tsx:162`

`<input type="number">` descarta a vírgula. Digitar `12,5` — a forma como se
escreve em português — grava **125**. Sem aviso, sem marca na tela: o campo
mostra `125` e o PDF imprime `125`.

Em um protocolo que registra torque de parafuso, tensão e resistência de
isolamento, este é o defeito de maior consequência prática de todos: produz um
documento de qualidade com valor dez vezes errado, assinado como verificado.

> Verificação 01.16.

**Correção aplicada:** o campo é `type="text"` com `inputMode="decimal"`, que
mantém o teclado numérico no celular. `shared/utils/numero.ts` aceita vírgula e
ponto, entende "1.234,56", recusa notação científica e devolve `null` para
texto que não seja número — que agora aparece na tela com o aviso de que nada
será registrado.

### 2.6 O editor da administração perde caracteres — **Corrigido**

`src/features/admin/EditorFormulario.tsx:40-72`

Cada tecla dispara `gravar`, que valida com Zod, escreve no IndexedDB e só então
atualiza o estado. Como o campo é controlado por esse estado, a digitação
disputa com a gravação.

Digitando "Texto digitado rapidamente pelo administrador" saiu
"Texto digitadorpdamente peloaministrador". Limpar o campo antes também não
funciona: o texto anterior volta e o novo é concatenado.

> Verificação 05.5.

**Correção aplicada:** `CampoTextoAdiado` mantém o texto local e grava depois da
pausa. O editor passa a partir sempre da definição mais recente, por
referência: sem isso, a gravação de um campo desfazia a do campo ao lado.

---

## 3. Defeitos que comprometem o documento entregue

### 3.1 Observação longa é truncada e passa por cima do rodapé — **Corrigido**

`src/core/export/pdf/documento.ts:324`

A altura da célula é calculada, mas nunca limitada à altura útil da página.
Quando a observação não cabe, o texto continua descendo: invade o rodapé com a
numeração de página e some no fim da folha.

Medido: de 200 linhas de observação, **54 foram impressas** — 73 % do texto
registrado pelo montador não chegou ao PDF; 5 trechos foram desenhados sobre a
faixa do rodapé.

> Verificações 03.2 e 03.3.

**Correção aplicada:** a linha da tabela passa a continuar na página seguinte,
repetindo o cabeçalho e marcando a continuação; aferido, status, data e operador
saem uma vez só. Os 8.891 caracteres do teste agora chegam inteiros ao PDF. De
quebra, o cabeçalho da tabela passa a ser repetido também quando uma etapa que
caberia inteira cai na virada da página — antes a tabela continuava na folha
nova sem cabeçalho nenhum.

### 3.2 Desativar uma etapa apaga do PDF um registro já feito

`src/core/export/pdf/documento.ts:669` e `src/core/forms/progresso.ts:17`

Quando a administração desativa uma etapa, tudo que já foi respondido nela
desaparece do progresso e do PDF. A resposta continua gravada no banco, mas
nenhuma tela a mostra e nenhum aviso é dado.

No teste, a etapa S1.1 marcada como verificada e com a observação "Ensaio
conferido com o inspetor." simplesmente **não existe** no PDF gerado depois da
desativação.

> Verificações 09.1 e 09.2.

**Correção:** ao desativar uma etapa, avisar quantos preenchimentos já têm
resposta nela; e imprimir no PDF as respostas de etapas desativadas em uma
seção "Etapas removidas do protocolo depois do preenchimento" — apagar registro
feito é o que um sistema de qualidade não pode fazer.

### 3.3 O PDF declara uma revisão que não corresponde ao conteúdo

`src/features/admin/EditorFormulario.tsx:40`

A administração altera o texto das etapas, ativa, desativa e reordena, mas o
campo `revisao` continua `rev00`. O PDF imprime "Revisão do formulário: rev00"
tanto para o formulário publicado quanto para qualquer versão editada
localmente.

Dois PDFs com a mesma revisão declarada podem conter conjuntos de etapas
diferentes. Para um protocolo ABB isso invalida a rastreabilidade — que é
justamente o motivo de a revisão ser impressa.

> Verificação 05.8.

**Correção:** marcar a definição editada (por exemplo `rev00+local.3`, com um
contador de edições e a data) e imprimir essa marca no PDF.

### 3.4 Fotos somem do ZIP por colisão de nome

`src/core/export/PdfExport.ts:31`

O nome no ZIP é `TAG_ETAPA_N.jpg` depois de `normalizarParaArquivo`. Duas TAGs
que normalizam para o mesmo texto — `QGBT-01` e `QGBT 01` — geram o mesmo nome,
e o JSZip mantém apenas o último.

No teste, duas fotos de TAGs diferentes viraram **um arquivo**. O inspetor
recebe menos fotos do que foram tiradas, sem nada indicando a perda.

> Verificação 03.5.

**Correção:** incluir o identificador da TAG no nome, ou uma pasta por TAG
dentro do ZIP. E impedir, no cadastro, duas TAGs com o mesmo nome no projeto.

### 3.5 Qualquer arquivo passa como anexo em PDF

`src/core/media/imagem.ts:89`

`ehPdf` aceita o arquivo se o tipo informado pelo navegador for
`application/pdf` **ou** se o nome terminar em `.pdf`. Um executável renomeado
para `.pdf` é gravado como anexo e viaja no dossiê entregue ao inspetor.

> Verificação 01.23.

**Correção:** conferir os primeiros bytes (`%PDF-`) antes de gravar.

### 3.6 Anexo sem limite de tamanho

`src/features/fill/AreaFotos.tsx:57`

Imagens são recomprimidas, mas o anexo em PDF é gravado como veio. Um arquivo de
60 MB entrou no IndexedDB sem aviso e sem verificação de espaço. Em celular, com
cota bem menor, o resultado é o `QuotaExceededError` no meio do preenchimento.

> Verificação 07.6.

**Correção:** limite explícito (10 MB é confortável para um certificado de
ensaio), mensagem clara ao ultrapassar, e uso de `estimarArmazenamento()` — que
já existe em `core/db/db.ts` e não é chamado em lugar nenhum — para avisar
quando o espaço estiver acabando.

---

## 4. Segurança

O modelo de ameaça aqui é modesto: aplicação sem servidor, dados só no aparelho,
sem autenticação por decisão de projeto. Mesmo assim há pontos a corrigir.

### 4.1 A senha da administração está legível no JavaScript publicado

`src/core/config.ts:9`

`SENHA_ADMIN` é constante de build. A senha aparece em texto claro no bundle
servido a qualquer visitante — trocar por `VITE_SENHA_ADMIN` não muda isso, só
troca qual senha fica exposta.

**Situação em 11/09/2026:** com a fila de liberação, a senha passou a ser
conferida no servidor, que devolve um token de sessão. A constante de build
continua no pacote, mas agora ela só abre as abas locais (formulários,
permissões, validação) quando o servidor não responde — a fila de liberação,
que é o que concede e revoga acesso, não abre com ela. A verificação 05.3
passou a medir isso.

> Verificação 05.3.

### 4.2 O acesso à administração é contornável em uma linha — **Corrigido**

`src/features/admin/Admin.tsx:14`

O controle era `sessionStorage.getItem('admin-liberado') === '1'`. Executar
`sessionStorage.setItem('admin-liberado','1')` no console abria a aba sem senha.

**Correção aplicada (11/09/2026):** a entrada passa pelo servidor, que devolve
um token de sessão; o token gravado é reconferido contra o servidor a cada
abertura da aba e descartado se ele não o reconhecer — escrever qualquer valor
na chave não abre nada. Sem servidor, a liberação vale só em memória, enquanto
a tela estiver aberta: não há mais chave persistida para forjar.

> Verificação 05.2.

> Verificação 05.2.

**Sobre 4.1:** o README já registra que "a senha só evita edição
acidental". A recomendação é assumir isso por completo — trocar a senha por uma
confirmação explícita ("Entendo que vou alterar o protocolo publicado") e parar
de chamar o mecanismo de senha, que dá uma impressão de proteção que ele não
tem. Se for preciso controle real, ele exige servidor, e aí a decisão é de
escopo do produto.

### 4.3 Conteúdo de apoio pode apontar para fora e a aplicação o busca — **Corrigido**

`src/core/forms/schema.ts:22` e `src/features/fill/ModalApoio.tsx:13`

`midiaApoio.src` é validado apenas como "string não vazia", e `caminho()`
devolve URLs absolutas e protocol-relative sem restrição. Um JSON importado com
`src: "//example.com/rastreio.png"` faz a aplicação buscar o recurso — a
requisição saiu de fato no teste.

Consequências: a operação offline deixa de ser integral; o IP e o horário de
cada consulta de ajuda vazam para um terceiro; e a instrução visual da etapa
passa a ser servida por quem controla aquele domínio.

> Verificações 05.12 e 05.13.

**Correção aplicada:** o schema recusa esquema, `//` inicial e `..`; o
`index.html` publica `default-src 'self'`, com `blob:` onde as fotos gravadas e
os PDFs gerados precisam.

### 4.4 Sem Content-Security-Policy — **Corrigido**

`index.html` não trazia CSP e o servidor portátil não enviava cabeçalho algum de
segurança. Uma CSP `default-src 'self'` fecha 4.3 sozinha e reduz o impacto de
qualquer falha futura de escape.

**Correção aplicada:** CSP no `index.html` e nos cabeçalhos do servidor
portátil.

> Verificação 08.6.

### 4.5 O servidor portátil aceita requisição de qualquer domínio — **Corrigido**

`cmd/servidor/main.go:123`

O servidor escuta só em `127.0.0.1` — correto — mas responde a qualquer valor de
`Host`. Isso abre DNS rebinding: um site aberto no mesmo navegador pode passar a
resolver o próprio domínio para `127.0.0.1`, ganhar a origem
`http://localhost:8080` e **ler todo o IndexedDB** — projetos, respostas e fotos
de todos os clientes que estiverem naquele pendrive.

> Verificação 08.7.

**Correção aplicada:** o servidor recusa com 421 qualquer `Host` que não seja
`localhost`, `127.0.0.1` ou `::1`, e passa a enviar `nosniff`, `X-Frame-Options:
DENY`, `no-referrer` e a mesma CSP.

### 4.6 Sem Error Boundary — **Corrigido**

Qualquer erro de renderização derrubava a aplicação inteira para tela branca,
sem mensagem e sem caminho de volta. É o que transformava o defeito 2.1 de
"importação falhou" em "o aplicativo não abre mais".

**Correção aplicada:** `app/LimiteDeErro.tsx` envolve a aplicação inteira.

### O que está correto

Escape de conteúdo pelo React (nenhum uso de `dangerouslySetInnerHTML`, `eval`
ou `innerHTML`); nomes de arquivo normalizados, inclusive a partir de texto
hostil; sem travessia de caminho no servidor portátil, nem por `..` cru na linha
de requisição; nenhuma dependência de produção com vulnerabilidade conhecida.

---

## 5. Inconsistências menores

| # | Onde | Comportamento |
|---|---|---|
| 5.1 | `NovoProjeto.tsx:24` | Limpar o campo "Quantidade de TAGs" apaga todos os nomes já digitados; re-digitar a quantidade devolve campos em branco (verificação 01.4) |
| 5.2 | `Preenchimento.tsx:186` | No filtro "pendentes", responder a etapa a tira da lista e a tela cai em "Nenhuma etapa neste filtro" — o fluxo natural de trabalho trava a cada resposta (verificação 02.5) |
| 5.3 | `projetoRepository.ts:97` | `adicionarTag` usa a contagem como ordem: remover a TAG do meio e adicionar outra produz ordem duplicada e ordenação ambígua (verificação 02.4) |
| 5.4 | `pdf/texto.ts:36` | Caracteres fora do WinAnsi viram `?` no PDF sem qualquer aviso — confirmado com `✔` e ideogramas |
| 5.5 | `documento.ts:400` | A coluna "Data" imprime a data da última alteração do preenchimento inteiro, igual em todas as etapas: uma etapa respondida há uma semana aparece com a data de hoje |
| 5.6 | `registro.tsx:89` | O tipo `texto` está implementado mas nenhum formulário publicado o usa — código sem cobertura de uso real |
| 5.7 | `main.go:138` | `strings.Contains(caminho, "sw")` marca `no-store` em qualquer asset cujo hash contenha "sw", desligando o cache desses arquivos sem motivo |
| 5.8 | `Preenchimento.tsx:102` | O cabeçalho recebe `numeroPedido` mesmo quando o formulário não tem esse campo: o valor fica gravado e nunca é exibido |

---

## 6. Recomendações

### Antes de publicar para os parceiros — **feito**

1. ~~**Vírgula decimal no campo numérico** (2.5).~~ Um número errado em um
   protocolo assinado é o pior resultado possível deste sistema, e era o defeito
   mais fácil de encontrar em uso normal.
2. ~~**Descarregar o salvamento ao sair da tela** (2.3) e **gravar por etapa**
   (2.4).~~ Eram as duas fontes de perda silenciosa de registro.
3. ~~**Validar o pacote de importação com Zod + Error Boundary** (2.1, 2.2,
   4.6).~~ Um arquivo corrompido inutilizava o aparelho.
4. ~~**Paginar a observação no PDF** (3.1).~~ Registro que não chega ao documento
   é registro que não existe.
5. ~~**Recusar `Host` estranho no servidor portátil** (4.5) e **restringir `src`
   a caminho relativo + CSP** (4.3, 4.4).~~
6. ~~**Debounce no editor da administração** (2.6).~~

Sobre a senha da administração: 4.2 foi corrigida em 11/09/2026, junto com a
fila de liberação — a sessão agora é conferida no servidor e não há chave
persistida para forjar. 4.1 continua como estava: a senha de build segue legível
no pacote, e agora só abre as abas locais quando o servidor não responde. A
recomendação segue de pé para ela — assumir que não é proteção e trocá-la por
uma confirmação explícita.

### Antes da próxima revisão de protocolo

7. **Marcar a revisão do formulário editado localmente** (3.3) e **preservar no
   PDF as respostas de etapas desativadas** (3.2). Sem isso, a rastreabilidade
   que o documento afirma ter não se sustenta em auditoria.
8. **Nomes únicos no ZIP e TAGs sem repetição** (3.4).
9. **Validar o PDF por assinatura de arquivo e limitar o tamanho do anexo**
   (3.5, 3.6), usando `estimarArmazenamento()`, que já existe e está sem uso.

### Sobre a arquitetura, olhando adiante

O ponto forte do projeto é o motor de formulários dirigido por JSON: acrescentar
a linha System Pro E Energy é mesmo só um arquivo novo, como o README promete. A
troca da persistência também está bem preparada — os repositórios isolam o Dexie
de verdade.

Três observações sobre o que a v1 deixou em aberto:

- **Concorrência.** O defeito 2.4 não é um descuido de implementação: é o
  modelo "estado em memória substitui o registro inteiro" encontrando o primeiro
  caso de dois escritores. Quando entrar o servidor central previsto, esse mesmo
  modelo vira conflito entre aparelhos. Gravar por etapa hoje já prepara o
  terreno para resolver por etapa amanhã.

- **Nada é imutável.** Editar o protocolo depois do preenchimento faz um
  registro desaparecer (3.2) sem mudar a revisão declarada (3.3). Um sistema de
  qualidade precisa da propriedade oposta: a definição usada no preenchimento
  deveria ser congelada junto com ele. Guardar no próprio preenchimento a
  definição vigente (e não só o número da revisão) resolveria 3.2 e 3.3 de uma
  vez, e é barato — são poucos KB por preenchimento.

- **Ausência de validação de faixa.** É decisão registrada e faz sentido: o
  julgamento é do inspetor. Mas "sem julgamento" e "sem verificação de
  digitação" são coisas diferentes. Um aviso não bloqueante — "150 MΩ está fora
  da faixa usual deste ensaio; confirma?" — preservaria a decisão de projeto e
  pegaria justamente o erro de 2.5.

### Sobre o próprio processo de teste

`scripts/fumaca.mjs` cobre bem o caminho feliz e por isso todos os defeitos
acima passaram por ele sem serem vistos: nenhum aparece quando tudo dá certo.
`scripts/testes/` foi escrito para cobrir o contorno, e vale mantê-lo rodando a
cada alteração.

Das 26 verificações que falhavam no levantamento, 15 passaram a `PASS` sem que o
teste precisasse ser reescrito. Duas foram reescritas, e vale registrar por quê:

- **02.1** media a sobrevivência a um `reload` disparado no mesmo instante do
  clique — o que testa o limite físico do IndexedDB, não o defeito. Agora mede a
  janela entre o toque e o registro (56 ms, contra 500 ms antes) e confere
  separadamente a sobrevivência ao recarregar.
- **03.3** contava linhas cujo texto começava com uma palavra específica, um
  número arbitrário. Agora compara o texto da coluna Descrição do PDF com o que
  foi registrado, caractere a caractere.

As 11 verificações que ainda falham são exatamente os itens em aberto das seções
3, 4.1, 4.2 e 5.
