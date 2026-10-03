@echo off
REM ---------------------------------------------------------------------
REM Sem acentos de proposito: o cmd.exe le arquivos .bat na code page OEM
REM do Windows, nao em UTF-8. Um "c cedilha" gravado em UTF-8 vira dois
REM bytes invalidos e o interpretador quebra as linhas no meio das
REM palavras, derrubando o arquivo inteiro. ASCII puro sempre funciona.
REM ---------------------------------------------------------------------
setlocal
set "SYS=%SystemRoot%\System32"
title Verificacao de Montagem de Paineis
cd /d "%~dp0"

echo ============================================================
echo   Verificacao de Montagem de Paineis
echo ============================================================
echo.

REM Testa o proprio node, e nao "where node": em PATH incomum o "where" e
REM que some, e o arquivo abortaria alegando falta de Node num micro que tem.
node --version >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado neste computador.
  echo.
  echo Instale em https://nodejs.org e abra este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Primeira execucao: instalando as dependencias.
  echo Isso demora alguns minutos e so acontece uma vez.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao instalar as dependencias.
    pause
    exit /b 1
  )
  echo.
)

echo Encerrando instancias anteriores, se houver...
call :encerrar

echo [1/3] Subindo o servidor de acesso...
start "ABB-checagem-servidor" /min cmd /c "npm run servidor"

echo [2/3] Subindo a aplicacao...
start "ABB-checagem-app" /min cmd /c "npm run dev"

echo [3/3] Aguardando a aplicacao responder...
set TENTATIVAS=0
:esperar
set /a TENTATIVAS+=1
%SYS%\curl.exe -s -o nul http://localhost:5173 && goto pronto
if %TENTATIVAS% GEQ 90 goto naosubiu
%SYS%\timeout.exe /t 1 /nobreak >nul
goto esperar

:naosubiu
echo.
echo [ERRO] A aplicacao nao subiu a tempo.
echo Procure as janelas minimizadas na barra de tarefas para ver o motivo.
echo.
pause
goto fim

:pronto
start "" http://localhost:5173

echo.
echo ============================================================
echo   Pronto. A aplicacao abriu no navegador.
echo.
echo   Endereco:      http://localhost:5173
echo   Administracao: na tela de login, "Entrar como administrador"
echo                  com a sua propria conta de administrador
echo ============================================================
echo.
echo Deixe ESTA janela aberta enquanto estiver usando.
echo Para encerrar tudo, pressione qualquer tecla aqui.
echo.
pause >nul

:fim
echo.
echo Encerrando...
call :encerrar
exit /b 0

REM ---------------------------------------------------------------------
REM Encerra o que estiver ocupando as duas portas da aplicacao.
REM
REM Pela porta, e nao por "taskkill /im node.exe": matar node.exe em geral
REM derrubaria qualquer outro programa Node do computador. O espaco depois
REM do numero no findstr evita casar com portas como 51730.
REM ---------------------------------------------------------------------
:encerrar
for %%P in (3001 5173) do (
  for /f "tokens=5" %%I in ('%SYS%\netstat.exe -ano ^| %SYS%\findstr.exe "LISTENING" ^| %SYS%\findstr.exe ":%%P "') do (
    %SYS%\taskkill.exe /pid %%I /t /f >nul 2>nul
  )
)
exit /b 0
