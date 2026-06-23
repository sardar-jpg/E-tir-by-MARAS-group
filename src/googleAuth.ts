import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import { getStorage } from "firebase/storage";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize Firebase client-side safely
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const storage = getStorage(app);

const provider = new GoogleAuthProvider();
// Gmail send, Drive, and Calendar scopes are genuinely used — see the
// Google Workspace tab in AdminPanel.tsx, which sends shipment status
// emails via the Gmail API, backs up logs to Drive, and schedules
// operations on Calendar using these exact scopes. (gmail.readonly is the
// one exception — see note below.)
provider.addScope("https://www.googleapis.com/auth/gmail.send");
provider.addScope("https://www.googleapis.com/auth/drive");
provider.addScope("https://www.googleapis.com/auth/calendar");
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

export const logoutGoogle = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  try {
    localStorage.removeItem("gmail_access_token");
  } catch (e) {
    console.warn("Failed to remove gmail token from localStorage", e);
  }
};
