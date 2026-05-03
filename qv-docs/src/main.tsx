// SPDX-License-Identifier: Apache-2.0
//
// Light, dependency-minimal entry. We deliberately drop tekivex-ui in
// favour of hand-written CSS so the docs site honours the same supply-chain
// posture as the server. React + react-router-dom remain (the spec/asset
// gain from server-rendered alternatives doesn't justify their footprint
// for a static marketing site).

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
