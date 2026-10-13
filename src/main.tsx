import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { iniciarEnvioAutomatico } from './core/arquivo/clienteArquivo';
import './index.css';

iniciarEnvioAutomatico();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
