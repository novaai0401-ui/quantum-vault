// SPDX-License-Identifier: Apache-2.0
//
// tekivex-ui v3 wires the ThemeProvider + Toast provider + global
// stylesheet. We use the `auroraLight` theme — warm light palette,
// no dark backgrounds anywhere — to match the Sigvault brand voice.

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { ThemeProvider, TkxToastProvider, auroraLight } from 'tekivex-ui';
import 'tekivex-ui/styles';

import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={auroraLight}>
      <TkxToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TkxToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
