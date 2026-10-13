# Testar no GitHub Codespaces

O Codespaces roda o aplicativo completo — servidor de acesso e site — numa
máquina do GitHub. Tudo é feito pelo navegador: nada é instalado nem executado
no seu computador.

## 1. Abrir

1. No repositório, botão verde **Code** → aba **Codespaces** → **Create
   codespace on main**.
2. Na primeira vez leva de 3 a 5 minutos: o Codespaces instala as dependências,
   compila o aplicativo e sobe o servidor na porta 3001.
3. Quando o servidor sobe, o aplicativo abre numa aba nova. Se o navegador
   bloquear a aba: painel **PORTAS** (**PORTS**, embaixo) → linha
   **Aplicativo (3001)** → ícone do globo, **Abrir no navegador** (**Open in
   Browser**).

## 2. Primeiro acesso

Na tela de entrada, **Criar conta** com o e-mail `ericg10456@gmail.com` (senha
de pelo menos 8 caracteres). Essa conta vira administradora e é a responsável
por todos os painéis: abre qualquer painel sem pedir acesso, e entra na
**Administração** pelo "Entrar como administrador".

Para testar o fluxo de um montador comum, crie outra conta com outro e-mail: o
pedido de acesso aparece em **Aprovações** da primeira conta. O servidor do
Codespaces não envia e-mail; os pedidos aparecem só na tela.

## 3. O que testar

| O quê | Onde |
|---|---|
| Fabricante e cliente final no cadastro do projeto | **Painéis → SEN Plus → Abrir checagens → Novo projeto**. Marque um checklist numa TAG: os dois campos aparecem no card do projeto, e não mais na TAG. |
| Barra de progresso | Abra um checklist e responda etapas: a barra do topo conta. |
| Foto obrigatória por etapa | **Administração → Painéis e checklists → Editar checklist** → abra uma seção → numa etapa "Conferir e fotografar", marque **Foto obrigatória**. Volte à lista de painéis (o aparelho baixa o checklist novo) e abra o preenchimento: marcada sem foto, a etapa não conta; com a foto, conta. |
| PDF de um checklist | Botão **Gerar PDF** no topo da tela de preenchimento. |
| PDF do projeto inteiro | **Gerar PDF** na tela do projeto: um PDF por tipo, com todas as TAGs. |
| Certificação (System Pro E Energy, Power, SAFR) | **Abrir solicitações → Nova solicitação → Preencher checklist**, e **Gerar PDF do checklist** na solicitação. |
| Painel personalizado | **Administração → Painéis e checklists → Cadastrar painel** (com o seu e-mail como responsável) → **Montar checklist**. Depois, como montador, crie um projeto nele e gere o PDF: sai no mesmo padrão. |

## 4. Testar no celular

Painel **PORTAS** (**PORTS**) → botão direito na porta 3001 → **Visibilidade
da porta → Pública** (**Port Visibility → Public**). Copie o endereço e abra no
celular. Sem isso o GitHub pede login antes de mostrar o aplicativo.

## 5. Atualizar depois de novos commits

No terminal do Codespaces:

```bash
git pull
bash scripts/codespace.sh --recompilar
```

Se o aplicativo sair do ar, `bash scripts/codespace.sh` sobe de novo. O log do
servidor fica em `/tmp/verificacao-servidor.log`.

## 6. Encerrar

O codespace para sozinho depois de 30 minutos sem uso. Para parar antes:
[github.com/codespaces](https://github.com/codespaces) → **⋯** → **Stop
codespace**. A conta gratuita do GitHub inclui cerca de 60 horas por mês na
máquina de 2 núcleos.

Os dados de teste (contas, painéis, aprovações) ficam no codespace e somem
quando ele é excluído.
