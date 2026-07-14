import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithCredential, reauthenticateWithPopup, reauthenticateWithCredential, User } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize Firebase client-side safely
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const storage = getStorage(app);

const isNative = Capacitor.isNativePlatform();

// Gmail send, Drive, and Calendar scopes are genuinely used — see the
// Google Workspace tab in AdminPanel.tsx, which sends shipment status
// emails via the Gmail API, backs up logs to Drive, and schedules
// operations on Calendar using these exact scopes. Needed on both the web
// popup flow and the native plugin's scopes option below.
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
];

const provider = new GoogleAuthProvider();
GOOGLE_SCOPES.forEach((scope) => provider.addScope(scope));
// Force select account to ensure they can pick the right account
provider.setCustomParameters({
  prompt: "select_account"
});

// Flag to track signing in process
let isSigningIn = false;
let currentSignInPromise: Promise<{ user: User; accessToken: string } | null> | null = null;

// Cached access token in memory with localStorage fallback
let cachedAccessToken: string | null = (() => {
  try {
    return localStorage.getItem("gmail_access_token");
  } catch (e) {
    console.warn("localStorage not accessible", e);
    return null;
  }
})();

// Initialize auth listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        try {
          localStorage.removeItem("gmail_access_token");
        } catch (e) {}
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      try {
        localStorage.removeItem("gmail_access_token");
      } catch (e) {}
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  if (currentSignInPromise) {
    console.warn("Google Sign-In is already in progress. Sharing active request.");
    return currentSignInPromise;
  }

  currentSignInPromise = (async () => {
    try {
      isSigningIn = true;

      if (isNative) {
        // Native iOS/Android: signInWithPopup does not work inside
        // Capacitor's native WebView (this is exactly what caused Apple
        // App Review to see an error when testing Google Sign-In on a
        // physical device). The Capacitor Firebase Authentication plugin
        // performs the real native Google Sign-In flow instead, then we
        // bridge the resulting credential into the regular firebase/auth
        // JS SDK below, so the rest of the app (which reads
        // auth.currentUser via the normal web SDK) keeps working exactly
        // as before, unchanged.
        const result = await FirebaseAuthentication.signInWithGoogle({
          scopes: GOOGLE_SCOPES,
        });

        const idToken = result.credential?.idToken;
        const accessToken = result.credential?.accessToken;
        if (!idToken) {
          throw new Error("Native Google Sign-In did not return an ID token");
        }
        if (!accessToken) {
          throw new Error("Failed to get google access token from native sign-in");
        }

        const jsCredential = GoogleAuthProvider.credential(idToken, accessToken);
        const jsResult = await signInWithCredential(auth, jsCredential);

        cachedAccessToken = accessToken;
        try {
          localStorage.setItem("gmail_access_token", cachedAccessToken);
        } catch (e) {
          console.warn("Failed to persist gmail token to localStorage", e);
        }
        return { user: jsResult.user, accessToken: cachedAccessToken };
      }

      // Web: unchanged, already-working popup-based flow.
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error("Failed to get google access token from Firebase Auth");
      }

      cachedAccessToken = credential.accessToken;
      try {
        localStorage.setItem("gmail_access_token", cachedAccessToken);
      } catch (e) {
        console.warn("Failed to persist gmail token to localStorage", e);
      }
      return { user: result.user, accessToken: cachedAccessToken };
    } catch (error: any) {
      if (error?.code === "auth/popup-closed-by-user" || error?.message?.includes("popup-closed-by-user")) {
        console.warn("Google sign in popup closed by user.");
      } else if (error?.code === "auth/cancelled-popup-request" || error?.message?.includes("cancelled-popup-request")) {
        console.warn("Google sign in popup request was cancelled by browser or secondary request.");
      } else {
        console.error("Google sign in error:", error);
      }
      throw error;
    } finally {
      isSigningIn = false;
      currentSignInPromise = null;
    }
  })();

  return currentSignInPromise;
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

/**
 * Reauthenticates the currently-signed-in Firebase user via the same
 * Google mechanism they're already signed in with — used exclusively by
 * the Driver "Delete My Account" flow (DriverApplication.tsx) when
 * `auth.currentUser.delete()` fails with `auth/requires-recent-login`.
 * Firebase requires a *recent* sign-in before it will let a client delete
 * its own Auth user; this re-proves that recent sign-in without signing
 * the user out or disturbing `auth.currentUser`, so the subsequent delete
 * retry can succeed. Deliberately not a new login entry point — it never
 * renders a button and only ever runs as a background step inside an
 * already-triggered deletion, reusing the exact same provider/scopes/
 * native-bridge logic as googleSignIn() above.
 */
export const reauthenticateDriverWithGoogle = async (): Promise<void> => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("No signed-in Firebase user to reauthenticate.");
  }

  if (isNative) {
    const result = await FirebaseAuthentication.signInWithGoogle({
      scopes: GOOGLE_SCOPES,
    });
    const idToken = result.credential?.idToken;
    const accessToken = result.credential?.accessToken;
    if (!idToken || !accessToken) {
      throw new Error("Native Google reauthentication did not return valid credentials.");
    }
    const jsCredential = GoogleAuthProvider.credential(idToken, accessToken);
    await reauthenticateWithCredential(user, jsCredential);
    return;
  }

  await reauthenticateWithPopup(user, provider);
};

export const logoutGoogle = async () => {
  if (isNative) {
    try {
      await FirebaseAuthentication.signOut();
    } catch (e) {
      console.warn("Native FirebaseAuthentication signOut failed (continuing with JS SDK signOut):", e);
    }
  }
  await auth.signOut();
  cachedAccessToken = null;
  try {
    localStorage.removeItem("gmail_access_token");
  } catch (e) {
    console.warn("Failed to remove gmail token from localStorage", e);
  }
};

