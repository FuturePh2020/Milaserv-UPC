import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layouts.css';
import './styles/print.css';

/** PRODUCTION entry: contains no component gallery or preview fixtures. */
const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
