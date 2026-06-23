import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.maras.etir',
  appName: 'Etir',
  webDir: 'dist',
  server: {
    // Load the real, live server instead of bundling static files into the
    // app — this is what fixes the black screen / Firebase Auth timeout:
    // Capacitor's default capacitor://localhost origin doesn't behave like
    // a real web origin for Firebase Auth or relative API calls. Pointing
    // at the actual deployed URL makes the native app behave exactly like
    // opening this same URL in Safari, just wrapped natively.
    url: 'https://e-tir-by-maras-v2-282009674985.europe-west1.run.app',
    cleartext: false
  }
};

export default config;
