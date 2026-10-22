import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'botanical-ui';
import App from './App';
import './globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <div className="antialiased selection:bg-bio-primary selection:text-white bg-bio-white text-bio-black min-h-screen transition-colors duration-300">
        <App />
      </div>
    </ThemeProvider>
  </StrictMode>,
);
