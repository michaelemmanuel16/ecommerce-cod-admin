import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import './index.css';
import './styles/tokens.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/dashboard.css';
import './styles/auth.css';
import './styles/orders.css';
import './styles/customers.css';
import './styles/deliveries.css';
import './styles/inventory.css';
import './styles/products.css';
import './styles/onboarding.css';
import './styles/reports.css';
import './styles/financeReports.css';
import './styles/checkoutForms.css';
import './styles/orderDrawer.css';
import './styles/settings.css';

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: import.meta.env.PROD ? 1.0 : 0,
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    ],
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<p>An unexpected error occurred. Please refresh the page.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
