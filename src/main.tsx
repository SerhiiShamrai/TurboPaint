import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Ініціалізація TailwindCSS через глобальну змінну для Vite
declare global {
  interface Window {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: any;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);