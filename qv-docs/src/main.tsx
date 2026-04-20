import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, quantumDark, TkxToastProvider } from 'tekivex-ui';
// tekivex-ui's exports map declares `./styles` -> dist/style.css but the
// file actually ships as dist/tekivex-ui.css. Until that mismatch is fixed
// upstream, we ship a vendored copy alongside our own stylesheet.
import './tekivex-ui.css';

import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={quantumDark}>
      <TkxToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TkxToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
