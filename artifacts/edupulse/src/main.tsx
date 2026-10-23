import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { registerPwaServiceWorker } from '@/lib/pwa';

import './index.css';

void registerPwaServiceWorker(import.meta.env.BASE_URL).catch(() => {
  console.warn('EduCore worker registration failed. Check HTTPS, the service-worker script response and browser site storage.');
});

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
