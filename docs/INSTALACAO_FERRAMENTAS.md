# Solicitação de Instalação de Ferramentas de Desenvolvimento

## Versão em Português (PT-BR)

**Assunto: Solicitação de Instalação de Ferramentas de Desenvolvimento - Projeto Sistema de Verificação de Montagem de Painéis ABB**

Prezados Colegas da Área de TI/IS,

Solicito a instalação de duas ferramentas necessárias para o desenvolvimento e testes locais do projeto "Sistema de Verificação de Montagem de Painéis ABB", que será deployado no Azure.

### Justificativa Técnica:

O projeto é composto por dois componentes que requerem ambientes de execução distintos:

#### 1. Node.js 20 LTS (ou superior) - Frontend da aplicação
- Necessário para compilar e executar a aplicação web (React com TypeScript)
- Usado para validar dados de entrada antes da compilação
- Essencial para rodar testes de fumaça e bateria de validação
- Não requer banco de dados ou serviços externos

#### 2. Go 1.24 (ou superior) - Servidor backend
- Necessário para compilar e executar o servidor de fila de liberação de acesso
- Gerencia a fila central de pedidos de acesso (arquivo JSON, sem banco de dados)
- Será o binário que rodará em produção no Azure
- Imprescindível para testar o fluxo completo antes da publicação

### Limitação:

Não possuo acesso de administrador na máquina local, portanto solicito que a instalação seja realizada pela área de TI/IS. A instalação não apresenta riscos de segurança ou conflitos, pois são ferramentas padrão de desenvolvimento amplamente utilizadas em ambiente corporativo.

### Impacto da Falta:

Sem essas ferramentas, não é possível:
- Validar o código localmente antes de commit
- Testar o fluxo completo (aplicação + servidor) antes do deploy
- Executar a bateria de testes automatizados
- Compilar o binário final para Azure

Agradeço a atenção e fico disponível para esclarecimentos adicionais.

---

## Version in English (EN-US)

**Subject: Installation Request for Development Tools - ABB Panel Assembly Verification System Project**

Dear IT/IS Team,

I am requesting the installation of two tools necessary for local development and testing of the "ABB Panel Assembly Verification System" project, which will be deployed on Azure.

### Technical Justification:

The project consists of two components that require distinct execution environments:

#### 1. Node.js 20 LTS (or higher) - Application Frontend
- Required to compile and run the web application (React with TypeScript)
- Used to validate input data before compilation
- Essential for running smoke tests and validation suite
- Does not require database or external services

#### 2. Go 1.24 (or higher) - Backend Server
- Required to compile and run the access release queue server
- Manages the central access request queue (JSON file, no database)
- Will be the binary running in production on Azure
- Imperative for testing the complete flow before publication

### Limitation:

I do not have administrator access on my local machine, therefore I am requesting that the installation be performed by the IT/IS team. The installation presents no security risks or conflicts, as these are standard development tools widely used in corporate environments.

### Impact of Not Installing:

Without these tools, it is not possible to:
- Validate code locally before commit
- Test the complete flow (application + server) before deployment
- Run the automated test suite
- Compile the final binary for Azure

I appreciate your attention and am available for any additional clarifications.
