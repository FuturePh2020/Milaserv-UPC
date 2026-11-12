import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { Gallery, GALLERY_PATH } from './gallery/Gallery.tsx';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layouts.css';
import './gallery/gallery.css';

/**
 * DEVELOPMENT entry (`npm run dev` / `build --dev` only): the normal application plus the
 * component gallery at #/__gallery. The gallery uses synthetic fixtures, calls no API, creates
 * no session and changes no data. It is never part of a production build.
 */
const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing');
createRoot(container).render(
  <StrictMode>
    <App devRoutes={(path) => (path === GALLERY_PATH || path.startsWith(`${GALLERY_PATH}/`) ? <Gallery path={path} /> : null)} />
  </StrictMode>,
);
