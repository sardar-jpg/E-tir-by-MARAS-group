import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register global Google Maps auth failure handler to support elegant fallback on RefererNotAllowedMapError
(window as any).gm_authFailure = () => {
  console.error("Google Maps API Authentication Failure detected.");
  (window as any).googleMapsAuthFailed = true;
  window.dispatchEvent(new CustomEvent("google-maps-auth-failure"));
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
