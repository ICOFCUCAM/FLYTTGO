import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './lib/i18n'; // initialise i18next before any component renders
import './index.css';

// toFixed safety patch
const origToFixed = Number.prototype.toFixed;
Number.prototype.toFixed = function(digits?: number) {
  const n = isNaN(Number(this)) ? 0 : Number(this);
  return origToFixed.call(n, digits);
};

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
