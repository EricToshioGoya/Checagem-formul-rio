import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { carregarTiposGuardados } from './core/forms/tiposChecklist';
import './index.css';

carregarTiposGuardados();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
