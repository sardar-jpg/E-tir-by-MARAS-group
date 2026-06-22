import React, { useState, useEffect, useRef } from "react";
import { Language, Shipment, Driver } from "./types";
import { TRANSLATIONS } from "./translations";
import AdminPanel from "./components/AdminPanel";
import DriverApplication from "./components/DriverApplication";
import PublicTracking from "./components/PublicTracking";
import ClientDashboard from "./components/ClientDashboard";
import LoginPage from "./components/LoginPage";
import PrivacyPolicyModal from "./components/PrivacyPolicyModal";
import TermsModal from "./components/TermsModal";
import { auth, googleSignIn, logoutGoogle, initAuth, storage } from "./googleAuth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Ship, MessageSquare, Globe, Laptop, Smartphone, Eye, Bell, CheckCircle2, ChevronRight, X, Send, Paperclip, FileUp, LogOut, Check, CheckCheck, User, FolderArchive, Image as ImageIcon, FileText } from "lucide-react";
import { apiFetch, getSavedBackendUrl, setSavedBackendUrl, isCustomDomainActive } from "./lib/api";
import { onAuthStateChanged } from "firebase/auth";

interface AppSession {
  role: "admin" | "driver" | "client";
  email?: string;
  driver?: Driver | null;
  client?: any;
  loginType?: "firebase" | "local";
  lastActive?: number;
}

export default function App() {
  // 1. Language State
  const [lang, setLang] = useState<Language>("en");

  // Custom premium toast notifier
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(prev => prev === msg ? null : prev), 3500);
  };

  // Gmail OAuth States
  const [gmailUser, setGmailUser] = useState<any>(null);
  const [gmailToken, setGmailToken] = useState<string | null>(null);
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);

  // Authentication state with local storage loading
  const [session, setSession] = useState<AppSession | null>(() => {
    try {
      const stored = localStorage.getItem("etir_session");
      if (stored) {
        const parsed: AppSession = JSON.parse(stored);
        if (parsed.lastActive) {
          const hours24 = 24 * 60 * 60 * 1000;
          if (Date.now() - parsed.lastActive > hours24) {
            console.log("Inactivity detected over 24 hours on initial load. Cleared.");
            localStorage.removeItem("etir_session");
            return null;
          }
        }
        // Update lastActive timestamp on successful load
        parsed.lastActive = Date.now();
        localStorage.setItem("etir_session", JSON.stringify(parsed));
        return parsed;
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  });

  // 2. Persona State
  const [activePersona, setActivePersona] = useState<'admin' | 'driver' | 'public' | 'client'>('admin');

  // 3. Viewport Simulation State for multi-device testing
  const [isMobileTestingMode, setIsMobileTestingMode] = useState(false);

  // Track if Firebase Auth state check has initialized to prevent flickering or early logout
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
  const [isTermsOpen, setIsTermsOpen] = useState(false);

  const [isBridgeOpen, setIsBridgeOpen] = useState(false);
  const [bridgeUrl, setBridgeUrl] = useState(() => getSavedBackendUrl());
  const isCustomDomain = isCustomDomainActive();

  // Monitor and validate Firebase Auth state against localStorage session on initial load
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let timeoutId: any = null;
    let retryTimeoutId: any = null;
    let isCleanedUp = false;

    async function handleFirebaseUser(firebaseUser: any) {
      try {
        const isExplicitlyLoggedOut = localStorage.getItem("etir_logged_out") === "true";
        if (isExplicitlyLoggedOut) {
          console.log("Ignore Firebase Auth change because user explicitly logged out.");
          localStorage.removeItem("etir_session");
          setSession(null);
          return;
        }

        const stored = localStorage.getItem("etir_session");
        const parsedSession: AppSession | null = stored ? JSON.parse(stored) : null;

        // Verify if session has expired
        if (parsedSession && parsedSession.lastActive) {
          const hours24 = 24 * 60 * 60 * 1000;
          if (Date.now() - parsedSession.lastActive > hours24) {
            console.log("Firebase Auth observed state with expired 24h local session.");
            localStorage.removeItem("etir_session");
            setSession(null);
            try {
              await auth.signOut();
            } catch (errSign) {
              console.error(errSign);
            }
            return;
          }
        }

        if (firebaseUser) {
          if (!firebaseUser.emailVerified) {
            console.warn("Persistent session observed with unverified email. Logging out.");
            localStorage.removeItem("etir_session");
            setSession(null);
            try {
              await auth.signOut();
            } catch (signOutErr) {
              console.error(signOutErr);
            }
            return;
          }

          const email = firebaseUser.email || "";
          const uid = firebaseUser.uid;

          const checkIsAdmin = 
            email.toLowerCase() === "sardar@maras.iq";

          // Server-side check or verify the user's email during session restoration.
          try {
            const verifyRes = await apiFetch("/api/verify-session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                role: checkIsAdmin ? "admin" : "driver",
                email: email,
                uid: uid,
                driverId: uid
              })
            });

            if (!verifyRes.ok) {
              console.warn("Server-side session verification failed or email unauthorized. Evicting session.");
              localStorage.removeItem("etir_session");
              setSession(null);
              try {
                await auth.signOut();
              } catch (signOutErr) {
                console.error(signOutErr);
              }
              return;
            }

            const verifyData = await verifyRes.json();
            
            if (verifyData.role === "driver") {
              // "If a user is logged in as a driver, ensure the system completely clears any previous admin-level session data in local storage..."
              console.log("Verified as driver. Evicting any lingering admin session details in local storage.");
              const cleanDriverSess: AppSession = {
                role: "driver",
                email: email,
                driver: verifyData.driver,
                loginType: "firebase",
                lastActive: Date.now()
              };
              localStorage.removeItem("etir_session"); // Fully purges any admin session keys
              localStorage.setItem("etir_session", JSON.stringify(cleanDriverSess));
              setSession(cleanDriverSess);
              return;
            }

            if (verifyData.role === "admin") {
              // Double check root email authority on the client for secondary defense
              if (email.toLowerCase() !== "sardar@maras.iq") {
                console.error("Critical admin security alert: admin email mismatch on client side.");
                localStorage.removeItem("etir_session");
                setSession(null);
                try {
                  await auth.signOut();
                } catch (sErr) {
                  console.error(sErr);
                }
                return;
              }

              const cleanAdminSess: AppSession = {
                role: "admin",
                email: email,
                driver: null,
                loginType: "firebase",
                lastActive: Date.now()
              };
              localStorage.setItem("etir_session", JSON.stringify(cleanAdminSess));
              setSession(cleanAdminSess);
              return;
            }
          } catch (apiErr) {
            console.error("Exception during API-powered session verification:", apiErr);
            // Non-spoof backup safety on network failure
            if (!checkIsAdmin && parsedSession && parsedSession.role === "admin") {
              console.warn("Forbidding admin access on network failure due to mismatch.");
              localStorage.removeItem("etir_session");
              setSession(null);
              return;
            }
          }

          if (checkIsAdmin) {
            // Crucial: If an explicit driver session is active locally, ignore the lingering Admin auth session to prevent hijacking
            if (parsedSession && parsedSession.role === "driver") {
              console.warn("Ignoring lingering Admin Firebase Auth user to preserve active local Driver session.");
              parsedSession.lastActive = Date.now();
              localStorage.setItem("etir_session", JSON.stringify(parsedSession));
              setSession(parsedSession);
              return;
            }

            if (!parsedSession || parsedSession.role !== "admin") {
              console.log("Firebase Auth detected Admin. Restoring Admin session...");
              const newSess: AppSession = { role: "admin", email: "sardar@maras.iq", driver: null, loginType: "firebase", lastActive: Date.now() };
              localStorage.setItem("etir_session", JSON.stringify(newSess));
              setSession(newSess);
            } else {
              parsedSession.lastActive = Date.now();
              parsedSession.email = "sardar@maras.iq";
              localStorage.setItem("etir_session", JSON.stringify(parsedSession));
              setSession(parsedSession);
            }
          } else {
            if (!parsedSession || parsedSession.role !== "driver" || parsedSession.driver?.id !== uid) {
              console.log("Firebase Auth detected Driver. Restoring Driver metadata...");
              let foundDriver: Driver | null = null;
              try {
                const resDrivers = await apiFetch("/api/drivers");
                if (resDrivers.ok) {
                  const text = await resDrivers.text();
                  if (!text.trim().startsWith("<")) {
                    const driversList: Driver[] = JSON.parse(text);
                    foundDriver = driversList.find(d => d.id === uid) || null;
                  }
                }
              } catch (apiErr) {
                console.warn("Could not retrieve driver metadata during automatic restore:", apiErr);
              }

              // Graceful local profile constructor fallback on network failure
              if (!foundDriver) {
                console.log("Constructing reliable client-side fallback driver profile.");
                foundDriver = {
                  id: uid,
                  name: firebaseUser.displayName || email.split("@")[0] || "Freight Driver",
                  username: email.split("@")[0] || "driver_account",
                  phone: firebaseUser.phoneNumber || "+964000000000",
                  truckNumber: "M-7733-IQ",
                  truckType: "reefer",
                  activeShipmentsCount: 0,
                  completedShipmentsCount: 0
                };
              }

              const newSess: AppSession = { role: "driver", driver: foundDriver, loginType: "firebase", lastActive: Date.now() };
              localStorage.removeItem("etir_session");
              localStorage.setItem("etir_session", JSON.stringify(newSess));
              setSession(newSess);
            } else {
              parsedSession.lastActive = Date.now();
              localStorage.setItem("etir_session", JSON.stringify(parsedSession));
              setSession(parsedSession);
            }
          }
        } else {
          if (parsedSession) {
            if (parsedSession.loginType === "firebase") {
              console.log("Firebase Auth logged out or session expired. Clearing active session...");
              localStorage.removeItem("etir_session");
              setSession(null);
            }
          }
        }
      } catch (err) {
        console.error("Error validating persistent session with Firebase Auth:", err);
      }
    }

    function startAuthCheckWithRetry(attempt = 0, delay = 1000) {
      if (isCleanedUp) return;

      // Unsubscribe previous listeners if any
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId);
        retryTimeoutId = null;
      }

      let resolved = false;

      // Safety timeout: If Firebase auth listener does not resolve in 5 seconds, trigger backoff retry
      timeoutId = setTimeout(() => {
        if (!resolved && !isCleanedUp) {
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
          const maxAttempts = 5;
          if (attempt < maxAttempts) {
            const nextDelay = delay * 2;
            console.warn(`Initial Firebase Auth state lookup timed out (attempt ${attempt + 1}/${maxAttempts + 1}). Retrying in ${delay}ms with exponential backoff...`);
            retryTimeoutId = setTimeout(() => {
              startAuthCheckWithRetry(attempt + 1, nextDelay);
            }, delay);
          } else {
            console.error("Maximum Firebase Auth lookup retry limit exceeded (Timeout). Operating with offline-first local session state.");
            setIsAuthChecked(true);
          }
        }
      }, 5000);

      try {
        unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
          resolved = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          if (retryTimeoutId) {
            clearTimeout(retryTimeoutId);
            retryTimeoutId = null;
          }
          
          await handleFirebaseUser(firebaseUser);
          setIsAuthChecked(true);
        }, (error) => {
          resolved = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          if (retryTimeoutId) {
            clearTimeout(retryTimeoutId);
            retryTimeoutId = null;
          }

          console.error(`Firebase onAuthStateChanged error on initial load (attempt ${attempt + 1}):`, error);
          const maxAttempts = 5;
          if (attempt < maxAttempts) {
            const nextDelay = delay * 2;
            console.warn(`Retrying in ${delay}ms with exponential backoff...`);
            retryTimeoutId = setTimeout(() => {
              startAuthCheckWithRetry(attempt + 1, nextDelay);
            }, delay);
          } else {
            console.error("Maximum Firebase Auth lookup retry limit exceeded (Error callback). Operating with cached local session state.");
            setIsAuthChecked(true);
          }
        });
      } catch (errInit) {
        resolved = true;
        console.error(`Synchronous exception during onAuthStateChanged subscription (attempt ${attempt + 1}):`, errInit);
        const maxAttempts = 5;
        if (attempt < maxAttempts) {
          const nextDelay = delay * 2;
          retryTimeoutId = setTimeout(() => {
            startAuthCheckWithRetry(attempt + 1, nextDelay);
          }, delay);
        } else {
          setIsAuthChecked(true);
        }
      }
    }

    startAuthCheckWithRetry();

    return () => {
      isCleanedUp = true;
      if (unsubscribe) unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
      if (retryTimeoutId) clearTimeout(retryTimeoutId);
    };
  }, []);

  // Update session activity helper
  const updateSessionActivity = () => {
    try {
      const stored = localStorage.getItem("etir_session");
      if (stored) {
        const parsed: AppSession = JSON.parse(stored);
        parsed.lastActive = Date.now();
        localStorage.setItem("etir_session", JSON.stringify(parsed));
        setSession(prev => {
          if (prev) {
            return { ...prev, lastActive: parsed.lastActive };
          }
          return prev;
        });
      }
    } catch (e) {
      console.error("Error updating session activity status:", e);
    }
  };

  // Passive expiration checker interval
  useEffect(() => {
    const checkExpiration = async () => {
      try {
        const stored = localStorage.getItem("etir_session");
        if (stored) {
          const parsed: AppSession = JSON.parse(stored);
          if (parsed.lastActive) {
            const hours24 = 24 * 60 * 60 * 1000;
            if (Date.now() - parsed.lastActive > hours24) {
              console.log("Passive check: session expired due to inactive 24 hours.");
              localStorage.removeItem("etir_session");
              setSession(null);
              setChatShipment(null);
              try {
                await auth.signOut();
              } catch (errSignOut) {
                console.error(errSignOut);
              }
            }
          }
        }
      } catch (e) {
        console.error("Error running passive session expiration check:", e);
      }
    };

    // Run check on mount and once every 30 seconds
    checkExpiration();
    const interval = setInterval(checkExpiration, 30000);
    return () => clearInterval(interval);
  }, []);

  // Monitor real-time user activity to update last active timestamp
  useEffect(() => {
    if (!session) return;

    let lastUpdated = Date.now();

    const handleUserActivity = () => {
      const now = Date.now();
      // Throttle to update at most once every 30 seconds
      if (now - lastUpdated > 30000) {
        lastUpdated = now;
        updateSessionActivity();
      }
    };

    window.addEventListener("mousedown", handleUserActivity);
    window.addEventListener("keydown", handleUserActivity);
    window.addEventListener("scroll", handleUserActivity);
    window.addEventListener("touchstart", handleUserActivity);

    return () => {
      window.removeEventListener("mousedown", handleUserActivity);
      window.removeEventListener("keydown", handleUserActivity);
      window.removeEventListener("scroll", handleUserActivity);
      window.removeEventListener("touchstart", handleUserActivity);
    };
  }, [session]);

  // Sync activePersona when session loads
  useEffect(() => {
    if (session) {
      setActivePersona(session.role);
    }
  }, [session?.role, session?.email]);

  // Listen to Google Auth changes
  useEffect(() => {
    const unsub = initAuth(
      (user, token) => {
        setGmailUser(user);
        setGmailToken(token);
      },
      () => {
        setGmailUser(null);
        setGmailToken(null);
      }
    );
    return () => unsub();
  }, []);

  const handleConnectGmail = async () => {
    setIsConnectingGmail(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setGmailUser(res.user);
        setGmailToken(res.accessToken);
      }
    } catch (e: any) {
      if (e?.code === 'auth/popup-closed-by-user' || e?.message?.includes('popup-closed-by-user')) {
        console.warn("Gmail Connection info: popup closed by user.");
      } else {
        console.error("Gmail Connection error:", e);
      }
    } finally {
      setIsConnectingGmail(false);
    }
  };

  const handleDisconnectGmail = async () => {
    try {
      await logoutGoogle();
      setGmailUser(null);
      setGmailToken(null);
    } catch (e) {
      console.error("Gmail Disconnection error:", e);
    }
  };

  // 3. Document/Attachment Chat context
  const [chatShipment, setChatShipment] = useState<Shipment | null>(null);
  const [chatDrawerTab, setChatDrawerTab] = useState<'messages' | 'attachments'>('messages');
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatMessageText, setChatMessageText] = useState("");
  const [activeDetailsId, setActiveDetailsId] = useState<string | null>(null);

  // Reset tab selection when drawer changes
  useEffect(() => {
    if (chatShipment) {
      setChatDrawerTab('messages');
    }
  }, [chatShipment?.id]);

  // Admin attachment states
  const [adminAttachOpen, setAdminAttachOpen] = useState(false);
  const [adminFileName, setAdminFileName] = useState("");
  const [adminFileCategory, setAdminFileCategory] = useState<string>("other");
  const [adminFileUrl, setAdminFileUrl] = useState("#");
  const [adminFile, setAdminFile] = useState<File | null>(null);
  const [isAdminUploading, setIsAdminUploading] = useState(false);
  const adminMessagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll admin chat to bottom when a new message arrives
  useEffect(() => {
    if (chatShipment && chatMessages.length > 0) {
      setTimeout(() => {
        adminMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 80);
    }
  }, [chatMessages.length, chatShipment?.id]);

  // 4. Token identification for Guest direct links
  const [urlToken, setUrlToken] = useState<string | null>(null);

  useEffect(() => {
    // Detect if accessed via a direct tracking link ?token=token-xxxx
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      setUrlToken(token);
      setActivePersona('public');
    }
  }, []);

  const handleLogout = async () => {
    try {
      localStorage.removeItem("etir_session");
      localStorage.setItem("etir_logged_out", "true");
    } catch (e) {
      console.warn("Storage write failed. Continuing logout using in-memory state:", e);
    }
    setSession(null);
    setChatShipment(null);
    try {
      await auth.signOut();
    } catch (e) {
      console.error("Firebase auth logout error:", e);
    }
  };

  const handleLoginSuccess = (newSession: AppSession) => {
    try {
      localStorage.removeItem("etir_logged_out");
    } catch (e) {}
    const sessionWithTime: AppSession = {
      ...newSession,
      lastActive: Date.now()
    };
    try {
      localStorage.setItem("etir_session", JSON.stringify(sessionWithTime));
    } catch (e) {
      console.warn("Storage write failed. Continuing login using in-memory state:", e);
    }
    setSession(sessionWithTime);
  };

  // Fetch direct chat context periodically for active chat drawer
  useEffect(() => {
    let interval: any;
    if (chatShipment) {
      const fetchChat = async () => {
        try {
          const res = await apiFetch(`/api/shipments/${chatShipment.id}/chat`);
          if (res.ok) {
            const data = await res.json();
            setChatMessages(data);

            const hasUnseenFromDriver = data.some((m: any) => m.sender === 'driver' && m.status !== 'seen');
            if (hasUnseenFromDriver) {
              await apiFetch(`/api/shipments/${chatShipment.id}/chat/seen`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ viewer: "admin" })
              });
            }
          }
        } catch (e) {
          console.error(e);
        }
      };
      fetchChat();
      interval = setInterval(fetchChat, 3000);
    }
    return () => clearInterval(interval);
  }, [chatShipment?.id]);

  const handleSendAdminMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatShipment || !chatMessageText.trim()) return;
    try {
      const res = await apiFetch(`/api/shipments/${chatShipment.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "admin",
          senderName: "MARAS Operations Office",
          type: "text",
          text: chatMessageText
        })
      });
      if (res.ok) {
        setChatMessageText("");
        const msg = await res.json();
        setChatMessages(prev => [...prev, msg]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendAdminAttachment = async () => {
    if (!chatShipment || !adminFileName.trim()) return;
    setIsAdminUploading(true);
    try {
      let finalFileUrl = adminFileUrl;

      if (adminFile && adminFileUrl && adminFileUrl.startsWith("data:")) {
        let uploadedViaGateway = false;
        try {
          // 1. Try uploading to our highly available central media gateway route
          const uploadRes = await apiFetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              base64DataUrl: adminFileUrl,
              filename: adminFileName || adminFile.name
            })
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            finalFileUrl = uploadData.url;
            uploadedViaGateway = true;
            console.log("Admin uploaded successfully via local media gateway:", finalFileUrl);
          }
        } catch (uploadGatewayErr) {
          console.log("Local media gateway fallback triggered:", uploadGatewayErr);
        }

        // 2. If local upload didn't succeed, fallback to Firebase Storage silently
        if (!uploadedViaGateway) {
          try {
            const fileRef = ref(storage, `shipments/${chatShipment.id}/${Date.now()}_${adminFile.name}`);
            const uploadResult = await uploadBytes(fileRef, adminFile);
            finalFileUrl = await getDownloadURL(uploadResult.ref);
            console.log("Admin uploaded successfully to Firebase Storage! URL:", finalFileUrl);
          } catch (storageErr) {
            console.log("Firebase Storage backup path also failed, retaining inline encoding representation:", storageErr);
          }
        }
      }

      const res = await apiFetch(`/api/shipments/${chatShipment.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "admin",
          senderName: "MARAS Operations Office",
          type: "file",
          fileName: adminFileName,
          fileCategory: adminFileCategory,
          fileUrl: finalFileUrl || "#",
          text: `Sent a document [${adminFileCategory.toUpperCase()}]: ${adminFileName}`
        })
      });
      if (res.ok) {
        setAdminFileName("");
        setAdminFileUrl("#");
        setAdminFile(null);
        setAdminAttachOpen(false);
        const msg = await res.json();
        setChatMessages(prev => [...prev, msg]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsAdminUploading(false);
    }
  };

  const isRtl = lang === 'ar';

  const t = (key: keyof typeof TRANSLATIONS['en']) => {
    return TRANSLATIONS[lang][key] || TRANSLATIONS['en'][key] || String(key);
  };

  // If accessed directly via security token callback, bypass sandbox UI completely
  if (urlToken) {
    return (
      <>
        <PublicTracking lang={lang} tokenFromUrl={urlToken} onViewPrivacy={() => setIsPrivacyOpen(true)} onViewTerms={() => setIsTermsOpen(true)} isMobile={isMobileTestingMode} />
        <PrivacyPolicyModal isOpen={isPrivacyOpen} onClose={() => setIsPrivacyOpen(false)} lang={lang} />
        <TermsModal isOpen={isTermsOpen} onClose={() => setIsTermsOpen(false)} lang={lang} />
      </>
    );
  }

  // Render a dedicated Initialization loading state while secure credentials synchronization/verification is in progress
  if (!isAuthChecked) {
    return (
      <div className="bg-slate-950 min-h-screen text-slate-100 flex flex-col items-center justify-center p-6 font-sans">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <div className="relative flex items-center justify-center animate-pulse">
            <div className="p-3 bg-orange-500 text-white rounded-xl shadow-lg shadow-orange-500/30">
              <Ship className="w-6 h-6 shrink-0" />
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-tight text-white uppercase">{t('brand')}</h3>
            <p className="text-xs text-slate-400 font-medium">Initializing secure operational gateway...</p>
          </div>
        </div>
      </div>
    );
  }

  // If no session is active, require login first
  if (!session) {
    return (
      <>
        <LoginPage 
          lang={lang} 
          onSetLang={(newLang) => setLang(newLang)} 
          onLoginSuccess={handleLoginSuccess} 
          onViewPrivacy={() => setIsPrivacyOpen(true)}
          onViewTerms={() => setIsTermsOpen(true)}
        />
        
        {/* Absolute Floating Badge for API Gateway setup on Login Screen */}
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
          <button
            onClick={() => {
              setBridgeUrl(getSavedBackendUrl() || window.location.origin);
              setIsBridgeOpen(true);
            }}
            className="bg-slate-950/90 text-orange-400 hover:text-orange-300 border border-slate-800 hover:border-orange-500/40 px-3 py-1.5 rounded-xl text-xs font-black shadow-lg shadow-black/50 transition-all flex items-center gap-2 cursor-pointer"
            title="Configure Sandbox API Gateway Sync"
          >
            <Globe className="w-3.5 h-3.5 text-orange-400 animate-pulse" />
            <span>Sandbox Link</span>
            {getSavedBackendUrl() && <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span>}
          </button>
        </div>

        {/* API GATEWAY BRIDGE SETTINGS MODAL */}
        {isBridgeOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-4">
              <button 
                onClick={() => setIsBridgeOpen(false)}
                className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-1 text-left">
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <span>🔗</span> Active Sandbox API Link
                </h3>
                <p className="text-xs text-slate-400">
                  Sync your custom preview domain (e.g., your website) with your active Google AI Studio development sandbox.
                </p>
              </div>

              <div className="space-y-3 bg-slate-950 border border-slate-850 p-4 rounded-xl text-xs text-left">
                <p className="font-bold text-slate-200 uppercase tracking-widest text-[9px]">How does this help?</p>
                <p className="text-slate-400 leading-normal">
                  Google AI Studio generates a temporary developer container for each session. Statically hosted custom domains can read live shipment data and simulation updates directly from this database container!
                </p>
                <div className="bg-slate-900/60 p-2.5 border border-slate-800/80 rounded font-mono text-[9px]/normal text-slate-300 select-all break-all overflow-y-auto max-h-[55px]">
                  Current Active Workspace URL:<br />
                  <strong className="text-emerald-400 font-bold">{window.location.origin}</strong>
                </div>
              </div>

              <div className="space-y-2 text-left">
                <label className="text-xs font-bold text-slate-300 block">Workspace API Base URL</label>
                <input 
                  type="text"
                  value={bridgeUrl}
                  onChange={(e) => setBridgeUrl(e.target.value)}
                  placeholder="https://ais-dev-xxxx-xxxxx.run.app"
                  className="w-full bg-slate-950 border border-slate-850 p-3 rounded-xl text-xs font-mono font-bold text-white focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
                <p className="text-[10px] text-slate-500 leading-normal">
                  Enter the Sandbox URL of your active AI Studio Dev environment or Shared Preview above.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => {
                    setSavedBackendUrl("");
                    setBridgeUrl("");
                    setIsBridgeOpen(false);
                    window.location.reload();
                  }}
                  className="px-4 py-2 border border-slate-805 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  Reset To Default
                </button>
                <button
                  onClick={() => {
                    setSavedBackendUrl(bridgeUrl);
                    setIsBridgeOpen(false);
                    window.location.reload();
                  }}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-orange-500/10 transition-colors cursor-pointer"
                >
                  Save & Sync Connection
                </button>
              </div>
            </div>
          </div>
        )}

        <PrivacyPolicyModal isOpen={isPrivacyOpen} onClose={() => setIsPrivacyOpen(false)} lang={lang} />
        <TermsModal isOpen={isTermsOpen} onClose={() => setIsTermsOpen(false)} lang={lang} />
      </>
    );
  }

  const isCurrentlyAdmin = !!(session && session.role === "admin");

  // If logged in as client, display authentic customer dashboard directly
  if (session.role === "client") {
    return (
      <div className="bg-slate-900 min-h-screen text-slate-100 font-sans flex flex-col justify-between animate-fade-in" dir={isRtl ? "rtl" : "ltr"}>
        <main className="flex-1 py-6 px-4">
          <ClientDashboard 
            lang={lang}
            clientCompanyName={session.client?.companyName || "Al-Bahi General Trading Ltd."}
            clientEmail={session.client?.email || "baha@al-bahi-trading.com"}
            clientId={session.client?.id || "client-1"}
            onLogout={handleLogout}
          />
        </main>
        <footer className="bg-slate-950 py-4 text-center text-[10px] text-slate-500 uppercase border-t border-slate-800 tracking-wider flex flex-col md:flex-row items-center justify-center gap-2 md:gap-4 px-4 shadow-sm shrink-0">
          <span>etir by MARAS Group © {new Date().getFullYear()} — Multi-Country Operations Gateway</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsPrivacyOpen(true)}
              className="hover:text-orange-500 transition-all cursor-pointer underline hover:no-underline font-bold tracking-widest outline-none bg-transparent border-0 p-0 text-[10px] uppercase font-mono"
            >
              🔒 Privacy Policy / Gizlilik Politikası
            </button>
            <span className="text-slate-800">|</span>
            <button
              type="button"
              onClick={() => setIsTermsOpen(true)}
              className="hover:text-orange-500 transition-all cursor-pointer underline hover:no-underline font-bold tracking-widest outline-none bg-transparent border-0 p-0 text-[10px] uppercase font-mono"
            >
              ⚖️ Terms & Conditions / Kullanım Koşulları
            </button>
          </div>
        </footer>
      </div>
    );
  }

  // If logged in as driver, display authentic mobile driver simulator view directly
  if (session.role === "driver") {
    return (
      <div className="bg-slate-900 min-h-screen text-slate-100 font-sans flex flex-col justify-between" dir={isRtl ? "rtl" : "ltr"}>
        <main className="flex-1">
          <DriverApplication 
            lang={lang} 
            loggedInDriverId={session.driver?.id} 
            loggedInDriver={session.driver} 
            onLogout={handleLogout}
          />
        </main>
        <footer className="bg-slate-950 py-4 text-center text-[10px] text-slate-500 uppercase border-t border-slate-800 tracking-wider flex flex-col md:flex-row items-center justify-center gap-2 md:gap-4 px-4 shadow-sm shrink-0">
          <span>etir by MARAS Group © {new Date().getFullYear()} — Multi-Country Operations Gateway</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsPrivacyOpen(true)}
              className="hover:text-orange-500 transition-all cursor-pointer underline hover:no-underline font-bold tracking-widest outline-none bg-transparent border-0 p-0 text-[10px] uppercase font-mono"
            >
              🔒 Privacy Policy / Gizlilik Politikası
            </button>
            <span className="text-slate-800">|</span>
            <button
              type="button"
              onClick={() => setIsTermsOpen(true)}
              className="hover:text-orange-500 transition-all cursor-pointer underline hover:no-underline font-bold tracking-widest outline-none bg-transparent border-0 p-0 text-[10px] uppercase font-mono"
            >
              ⚖️ Terms & Conditions / Kullanım Koşulları
            </button>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 min-h-screen text-slate-100 font-sans flex flex-col justify-between" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* PERSISTENT WORKSPACE CONTROL HEADER */}
      <header className="bg-slate-950 border-b border-slate-800 sticky top-0 z-40 p-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          
          {/* Logo / Title */}
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-orange-500 text-white rounded-xl shadow-lg shadow-orange-500/20">
              <Ship className="w-5 h-5 shrink-0" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-orange-500 tracking-widest">{t('brand')}</span>
              <h1 className="text-sm font-black text-white leading-tight tracking-tight">Active Deployment Testing Workspace</h1>
            </div>
          </div>

          {/* Persona selector & Language switch */}
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
            
            {/* Viewport Simulation Mode (Desktop vs. 375px Mobile Screen) */}
            <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setIsMobileTestingMode(false)}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                  !isMobileTestingMode ? 'bg-blue-600 text-white shadow shadow-blue-600/25' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Desktop View Mode"
              >
                <Laptop className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Desktop</span>
              </button>

              <button
                type="button"
                onClick={() => setIsMobileTestingMode(true)}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                  isMobileTestingMode ? 'bg-blue-600 text-white shadow shadow-blue-600/25' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Simulated Mobile View (375px)"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Mobile (375px)</span>
              </button>
            </div>

            {/* Active Persona switches */}
            <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl text-xs font-semibold">
              <button 
                onClick={() => {
                  setActivePersona('admin');
                  setChatShipment(null);
                }}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                  activePersona === 'admin' ? 'bg-orange-500 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Laptop className="w-3.5 h-3.5" />
                <span>{t('roleAdmin')}</span>
              </button>

              <button 
                onClick={() => {
                  setActivePersona('driver');
                  setChatShipment(null);
                }}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                  activePersona === 'driver' ? 'bg-orange-500 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>{t('roleDriver')}</span>
              </button>

              <button 
                onClick={() => {
                  setActivePersona('public');
                  setChatShipment(null);
                }}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                  activePersona === 'public' ? 'bg-orange-500 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{t('rolePublic')} Specimen</span>
              </button>

              <button 
                onClick={() => {
                  setActivePersona('client');
                  setChatShipment(null);
                }}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                  activePersona === 'client' ? 'bg-orange-500 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Test Corporate Customer View"
              >
                <User className="w-3.5 h-3.5" />
                <span>Customer</span>
              </button>
            </div>

            {/* API Gateway sync connection bridge control */}
            <button
              onClick={() => {
                setBridgeUrl(getSavedBackendUrl() || window.location.origin);
                setIsBridgeOpen(true);
              }}
              className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 text-xs font-black transition-all cursor-pointer border ${
                getSavedBackendUrl() 
                  ? 'bg-emerald-950/45 text-emerald-400 border-emerald-900/60 hover:bg-emerald-955' 
                  : 'bg-slate-900 text-orange-400 border-slate-800 hover:border-orange-500/30'
              }`}
              title="Configure API Gateway Sync Bridge"
            >
              <Globe className="w-3.5 h-3.5 text-orange-400 animate-pulse" />
              <span className="hidden sm:inline">API Bridge</span>
              {getSavedBackendUrl() && (
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
              )}
            </button>

            {/* Global Language Selector Dropdown */}
            <div className="flex items-center gap-2 border-l border-slate-800 pl-3">
              <Globe className="w-4 h-4 text-slate-400" />
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as Language)}
                className="bg-slate-900 text-white border border-slate-850 px-2 py-1 text-xs rounded-lg font-bold outline-none cursor-pointer"
              >
                <option value="en">English (EN)</option>
                <option value="tr">Türkçe (TR)</option>
                <option value="ar">العربية (AR)</option>
              </select>
            </div>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 bg-slate-900 hover:bg-red-950/40 border border-slate-800 hover:border-red-500/30 text-slate-400 hover:text-red-400 font-extrabold text-xs rounded-xl shadow transition-all cursor-pointer inline-flex items-center gap-1.5"
              title="Logout Account"
            >
              <LogOut className="w-3.5 h-3.5 text-red-500" />
              <span className="hidden sm:inline">Logout</span>
            </button>

          </div>

        </div>
      </header>

      {/* CORE VIEWPORT LAYER */}
      <main className={`flex-1 ${isMobileTestingMode ? "bg-slate-950/80 md:py-8 md:px-4 flex items-center justify-center min-h-[calc(100vh-80px)] bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:20px_20px]" : "relative"}`}>
        {isMobileTestingMode ? (
          <div className="relative mx-auto w-full h-[calc(100vh-80px)] md:w-[375px] md:h-[812px] bg-slate-900 md:rounded-[56px] md:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)] md:border-[14px] border-slate-950 overflow-hidden flex flex-col md:ring-2 md:ring-slate-850/80">
            
            {/* Simulated iPhone Status Bar - only visible on Desktop simulators */}
            <div className="hidden md:flex h-10 bg-slate-150 relative px-6 items-center justify-between text-[11px] font-bold text-slate-800 select-none pointer-events-none z-30 shrink-0">
              <span>12:45</span>
              {/* iPhone Notch Container */}
              <div className="w-28 h-5 bg-black rounded-b-2xl absolute left-1/2 -translate-x-1/2 top-0 flex items-center justify-center shadow-inner">
                <div className="w-12 h-1.5 bg-slate-900 rounded-full mr-2"></div>
                <div className="w-2 h-2 rounded-full bg-blue-950"></div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px]">5G</span>
                <span className="w-4 h-2.5 border border-slate-800 rounded-xs flex items-center p-0.5"><span className="w-full h-full bg-slate-800 rounded-xs"></span></span>
              </div>
            </div>

            {/* Simulated Scrollable In-App Viewport */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-900 relative flex flex-col scrollbar-thin scrollbar-thumb-slate-800">
              {activePersona === 'admin' ? (
                isCurrentlyAdmin ? (
                  <AdminPanel 
                    lang={lang} 
                    onSelectShipmentChat={(sh) => setChatShipment(sh)} 
                    openDetailsId={activeDetailsId}
                    setOpenDetailsId={setActiveDetailsId}
                    gmailUser={gmailUser}
                    gmailToken={gmailToken}
                    onConnectGmail={handleConnectGmail}
                    onDisconnectGmail={handleDisconnectGmail}
                    isMobile={true}
                    isConnectingGmail={isConnectingGmail}
                    adminEmail={session?.email}
                    adminType={session?.adminType || (session?.email?.toLowerCase() === "sardar@maras.iq" ? "super" : "operation")}
                  />
                ) : (
                  <div className="p-8 max-w-md mx-auto my-12 bg-slate-950 border border-red-900/40 rounded-2xl text-center shadow-2xl">
                    <div className="w-12 h-12 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-4 text-red-500">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <h3 className="text-base font-bold text-white mb-2">Administrative Access Restricted</h3>
                    <p className="text-sm text-slate-400 leading-relaxed mb-6">
                      Your credentials or session UID do not match the authorized administration officer. Administrative control panel access is strictly forbidden.
                    </p>
                    <button 
                      onClick={handleLogout}
                      className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold tracking-wide transition-all"
                    >
                      Sign Out / Re-authenticate
                    </button>
                  </div>
                )
              ) : activePersona === 'driver' ? (
                <DriverApplication 
                  lang={lang} 
                  loggedInDriverId={session?.role === 'driver' ? session.driver?.id : null}
                  loggedInDriver={session?.role === 'driver' ? session.driver : null}
                  onLogout={handleLogout}
                  isMobile={true}
                />
              ) : activePersona === 'client' ? (
                <ClientDashboard
                  lang={lang}
                  clientCompanyName="Al-Bahi General Trading Ltd."
                  clientEmail="baha@al-bahi-trading.com"
                  clientId="client-1"
                  onLogout={handleLogout}
                />
              ) : (
                /* Public Tracker specimen selector (to test public views in the sandbox easily) */
                <div className="bg-slate-50 min-h-screen text-slate-800">
                  <div className="p-4 bg-orange-500/10 border-b border-orange-200/50 text-orange-950 font-semibold text-xs flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Globe className="w-4 h-4 text-orange-600" />
                      <span>Sandbox Test Mode</span>
                    </div>
                  </div>

                  <div className="max-w-4xl mx-auto p-4 space-y-4">
                    <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-2">
                      <h4 className="font-bold text-slate-800 text-[10px] uppercase tracking-wider">Select Specimen:</h4>
                      <div className="flex flex-col gap-1.5 text-xs">
                        <button 
                          onClick={() => setUrlToken("token-1001")}
                          className={`px-3 py-1.5 rounded-lg border font-bold text-left ${
                            urlToken === "token-1001" ? "bg-orange-500 text-white border-orange-500" : "bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200"
                          }`}
                        >
                          MAR-2026-1001
                        </button>
                        <button 
                          onClick={() => setUrlToken("token-1002")}
                          className={`px-3 py-1.5 rounded-lg border font-bold text-left ${
                            urlToken === "token-1002" ? "bg-orange-500 text-white border-orange-500" : "bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200"
                          }`}
                        >
                          MAR-2026-1002
                        </button>
                      </div>
                    </div>
                  </div>

                  <PublicTracking lang={lang} tokenFromUrl={urlToken || "token-1001"} onViewPrivacy={() => setIsPrivacyOpen(true)} isMobile={true} />
                </div>
              )}
            </div>

            {/* Simulated bottom home indicator pill - only on desktop simulators */}
            <div className="hidden md:flex h-6 bg-slate-950 items-center justify-center shrink-0 z-30 select-none pointer-events-none">
              <div className="w-32 h-1 bg-white/40 rounded-full"></div>
            </div>

          </div>
        ) : (
          /* STANDARD FULL DESKTOP VIEWPORT */
          <>
            {activePersona === 'admin' ? (
              isCurrentlyAdmin ? (
                <AdminPanel 
                  lang={lang} 
                  onSelectShipmentChat={(sh) => setChatShipment(sh)} 
                  openDetailsId={activeDetailsId}
                  setOpenDetailsId={setActiveDetailsId}
                  gmailUser={gmailUser}
                  gmailToken={gmailToken}
                  onConnectGmail={handleConnectGmail}
                  onDisconnectGmail={handleDisconnectGmail}
                  isMobile={false}
                  isConnectingGmail={isConnectingGmail}
                  adminEmail={session?.email}
                  adminType={session?.adminType || (session?.email?.toLowerCase() === "sardar@maras.iq" ? "super" : "operation")}
                />
              ) : (
                <div className="p-8 max-w-md mx-auto my-12 bg-slate-950 border border-red-900/40 rounded-2xl text-center shadow-2xl">
                  <div className="w-12 h-12 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-4 text-red-500">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <h3 className="text-base font-bold text-white mb-2">Administrative Access Restricted</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-6">
                    Your credentials or session UID do not match the authorized administration officer. Administrative control panel access is strictly forbidden.
                  </p>
                  <button 
                    onClick={handleLogout}
                    className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold tracking-wide transition-all"
                  >
                    Sign Out / Re-authenticate
                  </button>
                </div>
              )
            ) : activePersona === 'driver' ? (
              <DriverApplication 
                lang={lang} 
                loggedInDriverId={session?.role === 'driver' ? session.driver?.id : null}
                loggedInDriver={session?.role === 'driver' ? session.driver : null}
                onLogout={handleLogout}
                isMobile={false}
              />
            ) : activePersona === 'client' ? (
              <div className="w-full max-w-7xl mx-auto p-4 md:p-6 animate-fade-in">
                <ClientDashboard
                  lang={lang}
                  clientCompanyName="Al-Bahi General Trading Ltd."
                  clientEmail="baha@al-bahi-trading.com"
                  clientId="client-1"
                  onLogout={handleLogout}
                />
              </div>
            ) : (
              /* Public Tracker specimen selector (to test public views in the sandbox easily) */
              <div className="bg-slate-50 min-h-screen text-slate-800">
                <div className="p-4 bg-orange-500/10 border-b border-orange-200/50 text-orange-950 font-semibold text-xs flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Globe className="w-4 h-4 text-orange-600 animate-spin-slow" />
                    <span>Sandbox Test Mode: Simulating public view-only page of MARAS shipments without logging in.</span>
                  </div>
                  <p className="text-[10px] text-orange-850 font-bold uppercase tracking-wider">MARAS Group Security Protocol</p>
                </div>

                <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-2">
                    <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Select active shipment token to view tracking link preview:</h4>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button 
                        onClick={() => setUrlToken("token-1001")}
                        className={`px-3.5 py-1.5 rounded-lg border font-bold ${
                          urlToken === "token-1001" ? "bg-orange-500 text-white border-orange-500" : "bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200"
                        }`}
                      >
                        Shipment MAR-2026-1001
                      </button>
                      <button 
                        onClick={() => setUrlToken("token-1002")}
                        className={`px-3.5 py-1.5 rounded-lg border font-bold ${
                          urlToken === "token-1002" ? "bg-orange-500 text-white border-orange-500" : "bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200"
                        }`}
                      >
                        Shipment MAR-2026-1002
                      </button>
                      <button 
                        onClick={() => setUrlToken("token-1003")}
                        className={`px-3.5 py-1.5 rounded-lg border font-bold ${
                          urlToken === "token-1003" ? "bg-orange-500 text-white border-orange-500" : "bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200"
                        }`}
                      >
                        Shipment MAR-2026-1003 (Disabled Sample)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Displaying actual public template */}
                <PublicTracking lang={lang} tokenFromUrl={urlToken || "token-1001"} onViewPrivacy={() => setIsPrivacyOpen(true)} isMobile={isMobileTestingMode} />
              </div>
            )}
          </>
        )}
      </main>

      {/* ADMIN LEVEL DRAWER CHAT PANEL (Slides in when Admin clicks message balloon on any active shipment) */}
      {chatShipment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end">
          <div className="bg-slate-950 border-l border-slate-800 w-full max-w-md h-full flex flex-col justify-between text-slate-200 animate-slide-in">
            
            {/* Chat Drawer Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div>
                <span className="text-[10px] text-orange-500 uppercase tracking-widest font-extrabold">{t('chat')}</span>
                <h3 className="font-extrabold text-sm text-white">#{chatShipment.shipmentNumber} ➔ helpline</h3>
                <p className="text-[10px] text-slate-400 truncate max-w-[200px]">Active Driver: {chatShipment.assignedDriverName}</p>
              </div>
              
              <button 
                onClick={() => setChatShipment(null)}
                className="p-1.5 bg-slate-900 border border-slate-850 hover:bg-slate-850 rounded-lg text-slate-300 pointer cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Privacy Check Disclaimer */}
            <div className="p-3 bg-slate-900/40 border-b border-slate-800/80 text-[10px]/normal text-slate-300 px-5">
              💡 Document and photo attachments uploaded by driver through chat sync instantly to the shipment Documents folder.
            </div>

            {/* Chat Drawer Tabs */}
            <div className="flex border-b border-slate-800 bg-slate-950 font-mono text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setChatDrawerTab('messages')}
                className={`flex-1 py-3 text-center border-b-2 hover:bg-slate-900/40 transition-all cursor-pointer ${
                  chatDrawerTab === 'messages' 
                    ? 'border-orange-500 text-orange-400 font-extrabold' 
                    : 'border-transparent text-slate-450 hover:text-slate-350'
                }`}
              >
                Support Messages
              </button>
              <button
                type="button"
                onClick={() => setChatDrawerTab('attachments')}
                className={`flex-1 py-3 text-center border-b-2 hover:bg-slate-900/40 transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  chatDrawerTab === 'attachments' 
                    ? 'border-orange-500 text-orange-400 font-extrabold' 
                    : 'border-transparent text-slate-450 hover:text-slate-350'
                }`}
              >
                <span>Documents & Scans</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${
                  chatDrawerTab === 'attachments' ? 'bg-orange-950 text-orange-405' : 'bg-slate-900 text-slate-500'
                }`}>
                  {chatShipment.documents?.length || 0}
                </span>
              </button>
            </div>

            {chatDrawerTab === 'messages' ? (
              <>
                {/* Message Thread Scrollable */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {chatMessages.map((msg) => {
                    const isAdmin = msg.sender === 'admin';
                    const isSeenReceipt = isAdmin && msg.status === 'seen';
                    return (
                      <div key={msg.id} className={`flex flex-col max-w-[80%] ${isAdmin ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                        <span className="text-[9px] text-slate-500 font-bold mb-0.5">{msg.senderName}</span>
                        
                        <div className={`p-3 rounded-2xl text-xs leading-relaxed shadow-sm relative transition-all duration-500 ${
                          isAdmin 
                            ? (msg.status === 'seen'
                              ? 'bg-slate-800/95 text-slate-100 rounded-tr-none border border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/10'
                              : 'bg-slate-800 text-slate-100 rounded-tr-none border border-slate-700') 
                            : 'bg-orange-600 text-white rounded-tl-none font-medium'
                        }`}>
                          {/* Read Receipt subtle highlight overlay */}
                          {isSeenReceipt && (
                            <span className="absolute inset-0 rounded-2xl rounded-tr-none border border-emerald-400 bg-emerald-500/5 animate-pulse pointer-events-none" />
                          )}
                          
                          {msg.type === 'file' ? (
                            <div className="space-y-2">
                              <span className={`${isAdmin ? 'bg-slate-900 text-slate-350' : 'bg-orange-850 text-orange-250'} text-[8px] font-mono font-bold px-1.5 py-0.5 rounded uppercase block w-max`}>
                                {msg.fileCategory}
                              </span>
                              <a 
                                href={msg.fileUrl || "#"} 
                                download={msg.fileName || "document.bin"}
                                onClick={(e) => {
                                  if (!msg.fileUrl || msg.fileUrl === "#") {
                                    e.preventDefault();
                                    alert("Document specimen offline preview active.");
                                  }
                                }}
                                className="font-bold underline cursor-pointer flex items-center gap-1 hover:text-orange-200 break-all"
                              >
                                <FileUp className="w-3.5 h-3.5 shrink-0 inline" />
                                <span>{msg.fileName}</span>
                              </a>
                              
                              {/* Rich inline image preview if file category is photo or looks like an image */}
                              {((msg.fileCategory === 'photo' || msg.fileName?.match(/\.(jpeg|jpg|gif|png|webp)/i)) && msg.fileUrl && msg.fileUrl !== '#') && (
                                <div className="mt-2 rounded-lg overflow-hidden border border-slate-700 max-w-[180px]">
                                  <img 
                                    src={msg.fileUrl} 
                                    alt={msg.fileName} 
                                    className="w-full h-auto object-cover max-h-[120px]" 
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              )}
                            </div>
                          ) : (
                            <p>{msg.text}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 text-[8px] text-slate-500 font-mono select-none">
                          <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {isAdmin ? (
                            <span className={`inline-flex items-center gap-1 px-1 py-0.5 rounded-md transition-all ${
                              msg.status === 'seen' 
                                ? 'text-emerald-400 bg-emerald-950/35 font-black ring-1 ring-emerald-500/10' 
                                : 'text-slate-500 bg-slate-900/20'
                            }`}>
                              • 
                              {msg.status === 'seen' ? (
                                <>
                                  <CheckCheck className="w-2.5 h-2.5 text-emerald-400 shrink-0 scale-110 animate-bounce" style={{ animationDuration: '2s' }} />
                                  <span className="animate-pulse">
                                    {lang === 'tr' ? 'Sürücü Gördü' : lang === 'ar' ? 'شاهدها السائق' : 'Seen by Driver'}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Check className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                                  <span>
                                    {lang === 'tr' ? 'Gönderildi' : lang === 'ar' ? 'تم الإرسال' : 'Sent'}
                                  </span>
                                </>
                              )}
                            </span>
                          ) : (
                            <span className={`inline-flex items-center gap-1 px-1 py-0.5 rounded-md transition-all ${
                              msg.status === 'seen' 
                                ? 'text-orange-400 bg-orange-950/35 font-bold' 
                                : 'text-slate-400 bg-slate-900/20'
                            }`}>
                              • 
                              {msg.status === 'seen' ? (
                                <>
                                  <CheckCheck className="w-2.5 h-2.5 text-orange-400 shrink-0" />
                                  <span>
                                    {lang === 'tr' ? 'Biz Okuduk' : lang === 'ar' ? 'مقروءة لدينا' : 'Read'}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Check className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                                  <span>
                                    {lang === 'tr' ? 'Sürücüden Gelen' : lang === 'ar' ? 'غير مقروء بعد' : 'Unread'}
                                  </span>
                                </>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {chatMessages.length === 0 && (
                    <div className="py-20 text-center text-slate-600 italic text-xs">
                      No messaging threads active for shipment {chatShipment.shipmentNumber}. Send a greeting to the driver!
                    </div>
                  )}
                  {/* Thread autoscroll anchor point */}
                  <div ref={adminMessagesEndRef} />
                </div>

                {/* Admin typing input bar */}
                <form onSubmit={handleSendAdminMessage} className="bg-slate-950 p-4 border-t border-slate-855 flex items-center gap-2 relative">
                  <button 
                    type="button" 
                    onClick={() => setAdminAttachOpen(true)}
                    title="Attach Document / Photo"
                    className="p-3 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white rounded-xl transition-all cursor-pointer inline-flex items-center font-sans"
                  >
                    <Paperclip className="w-4 h-4 shrink-0" />
                  </button>

                  <input 
                    type="text" 
                    placeholder={t('typeMessage')}
                    value={chatMessageText}
                    onChange={(e) => setChatMessageText(e.target.value)}
                    className="flex-1 p-3 bg-slate-900 border border-slate-800 text-white text-xs rounded-xl focus:outline-none placeholder-slate-500 focus:border-slate-500"
                  />
                  
                  <button 
                    type="submit" 
                    disabled={!chatMessageText.trim()}
                    className="p-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-all cursor-pointer inline-flex items-center"
                  >
                    <Send className="w-4 h-4 shrink-0" />
                  </button>
                </form>
              </>
            ) : (
              /* Shipment Document Viewer Tab with BULK DOWNLOAD */
              <div className="flex-1 overflow-y-auto p-5 space-y-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="font-extrabold text-sm text-white">Attachment Files ({chatShipment.documents?.length || 0})</h4>
                      <p className="text-[10px] text-slate-500">Synced operational backup documents</p>
                    </div>
                    
                    {chatShipment.documents && chatShipment.documents.length > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            triggerToast("Generating ZIP archive...");
                            const { downloadDocumentsAsZip } = await import('./utils/zipHelper');
                            await downloadDocumentsAsZip(chatShipment.shipmentNumber, chatShipment.documents);
                            triggerToast("ZIP Downloaded successfully!");
                          } catch (err) {
                            console.error(err);
                            triggerToast("Failed to compile ZIP registry.");
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 active:scale-95 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-orange-500/10 transition-all cursor-pointer border-0"
                      >
                        <FolderArchive className="w-3.5 h-3.5 shrink-0" />
                        <span>Bulk Download</span>
                      </button>
                    )}
                  </div>

                  {chatShipment.documents && chatShipment.documents.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2.5">
                      {chatShipment.documents.map((doc) => (
                        <div key={doc.id} className="p-3 bg-slate-900/60 border border-slate-850 rounded-xl flex items-center justify-between gap-3 hover:border-slate-700 transition-all">
                          <div className="flex items-center gap-2.5 truncate">
                            {doc.category === 'photo' ? (
                              <ImageIcon className="w-4 h-4 text-orange-400 shrink-0" />
                            ) : (
                              <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                            )}
                            <div className="truncate text-xs">
                              <p className="font-bold text-slate-200 truncate">{doc.name}</p>
                              <span className="text-[9px] text-slate-500 font-mono block uppercase">{doc.category} • {doc.uploadedBy}</span>
                            </div>
                          </div>

                          <a 
                            href={doc.url} 
                            download
                            onClick={(e) => {
                              if (doc.url === "#") {
                                e.preventDefault();
                                triggerToast("Sample document downloaded");
                              }
                            }}
                            className="p-1 px-2.5 bg-slate-850 hover:bg-slate-800 text-slate-205 border border-slate-800 hover:border-slate-700 rounded text-[10px] font-mono leading-none transition-all cursor-pointer"
                          >
                            GET
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-20 text-center text-slate-500 italic text-xs">
                      No documents registered. Any driver camera photos or uploads saved through the live support chat are compiled here instantly.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Admin Attachment Modal Overlay inside chat drawer */}
            {adminAttachOpen && (
              <div className="absolute inset-0 bg-slate-950/95 z-40 flex items-center justify-center p-4">
                <div className="bg-slate-900 p-4 border border-slate-800 rounded-2xl w-full max-w-[340px] space-y-4 text-xs">
                  <div className="flex items-center justify-between">
                    <h5 className="font-bold text-slate-200 font-mono text-[11px] uppercase tracking-wider">Attach Document / Photo</h5>
                    <button onClick={() => setAdminAttachOpen(false)} className="text-slate-500 cursor-pointer border-0 bg-transparent"><X className="w-4 h-4" /></button>
                  </div>

                  <div className="space-y-3 font-sans">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 block uppercase font-mono">Upload Real file</label>
                      <input 
                        type="file" 
                        accept="image/*,application/pdf,.doc,.docx"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setAdminFile(file);
                            setAdminFileName(file.name);
                            if (file.type.startsWith("image/")) {
                              setAdminFileCategory("photo");
                            } else if (file.name.toLowerCase().includes("cmr")) {
                              setAdminFileCategory("cmr");
                            } else if (file.name.toLowerCase().includes("invoice")) {
                              setAdminFileCategory("invoice");
                            } else if (file.name.toLowerCase().includes("packing")) {
                              setAdminFileCategory("packing_list");
                            } else if (file.name.toLowerCase().includes("customs")) {
                              setAdminFileCategory("customs");
                            } else if (file.name.toLowerCase().includes("delivery") || file.name.toLowerCase().includes("pod")) {
                              setAdminFileCategory("delivery_proof");
                            }
                            
                            const reader = new FileReader();
                            reader.onload = (evt) => {
                              const b64 = evt.target?.result as string;
                              setAdminFileUrl(b64);
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                        className="w-full p-2 bg-slate-950 border border-slate-800 text-slate-200 rounded-lg text-[11px]"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 block uppercase font-mono">Or Manual File Name</label>
                      <input 
                        type="text" 
                        placeholder="e.g. CUSTOMS_RELEASE_MANIFEST.pdf" 
                        value={adminFileName}
                        onChange={(e) => setAdminFileName(e.target.value)}
                        className="w-full p-2 bg-slate-950 border border-slate-800 text-slate-250 rounded-lg text-[11px]"
                      />
                    </div>

                    <div className="space-y-1 font-sans">
                      <label className="text-[10px] font-bold text-slate-400 block uppercase font-mono">Document Category</label>
                      <select
                        value={adminFileCategory}
                        onChange={(e) => setAdminFileCategory(e.target.value)}
                        className="w-full p-2 bg-slate-950 border border-slate-800 text-slate-200 rounded-lg text-xs"
                      >
                        <option value="cmr">CMR Document</option>
                        <option value="invoice">Invoice Receipt</option>
                        <option value="packing_list">Packing Sheet</option>
                        <option value="customs">Customs Clearance Receipt</option>
                        <option value="delivery_proof">Delivery Voucher (POD)</option>
                        <option value="photo">Cargo Live Photo</option>
                        <option value="other">Other PDF / Doc File</option>
                      </select>
                    </div>

                    <button 
                      type="button"
                      onClick={handleSendAdminAttachment}
                      disabled={!adminFileName.trim() || isAdminUploading}
                      className="w-full p-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-850 text-white font-extrabold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 text-[11px]"
                    >
                      {isAdminUploading ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <FileUp className="w-4 h-4 shrink-0" />
                      )}
                      <span>{isAdminUploading ? "Uploading to Cloud Storage..." : "Attach Document to Chat"}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* CORE STATS FOOTER BRANDING */}
      <footer className="bg-slate-950 py-5 text-center text-[10px] text-slate-500 uppercase border-xs border-slate-800 tracking-wider flex flex-col md:flex-row items-center justify-center gap-2 md:gap-4 px-4 shadow-inner">
        <span>etir by MARAS Group © {new Date().getFullYear()} — Multi-Country Operations Gateway | All rights reserved.</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsPrivacyOpen(true)}
            className="hover:text-orange-500 transition-all cursor-pointer underline hover:no-underline font-bold tracking-widest outline-none bg-transparent border-0 p-0 text-[10px] uppercase font-sans"
          >
            🔒 Privacy Policy / Gizlilik Politikası
          </button>
          <span className="text-slate-800">|</span>
          <button
            type="button"
            onClick={() => setIsTermsOpen(true)}
            className="hover:text-orange-500 transition-all cursor-pointer underline hover:no-underline font-bold tracking-widest outline-none bg-transparent border-0 p-0 text-[10px] uppercase font-sans"
          >
            ⚖️ Terms & Conditions / Kullanım Koşulları
          </button>
        </div>
      </footer>

      <PrivacyPolicyModal isOpen={isPrivacyOpen} onClose={() => setIsPrivacyOpen(false)} lang={lang} />
      <TermsModal isOpen={isTermsOpen} onClose={() => setIsTermsOpen(false)} lang={lang} />

      {/* API GATEWAY BRIDGE SETTINGS MODAL */}
      {isBridgeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-4">
            <button 
              onClick={() => setIsBridgeOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1 text-left">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <span>🔗</span> Active Sandbox API Link
              </h3>
              <p className="text-xs text-slate-400">
                Sync your custom preview domain (e.g., your website) with your active Google AI Studio development sandbox.
              </p>
            </div>

            <div className="space-y-3 bg-slate-950 border border-slate-850 p-4 rounded-xl text-xs text-left">
              <p className="font-bold text-slate-200 uppercase tracking-widest text-[9px]">How does this help?</p>
              <p className="text-slate-400 leading-normal">
                Google AI Studio generates a temporary developer container for each session. Statically hosted custom domains can read live shipment data and simulation updates directly from this database container!
              </p>
              <div className="bg-slate-900/60 p-2.5 border border-slate-800/80 rounded font-mono text-[9px]/normal text-slate-300 select-all break-all overflow-y-auto max-h-[55px]">
                Current Active Workspace URL:<br />
                <strong className="text-emerald-400 font-bold">{window.location.origin}</strong>
              </div>
            </div>

            <div className="space-y-2 text-left">
              <label className="text-xs font-bold text-slate-300 block">Workspace API Base URL</label>
              <input 
                type="text"
                value={bridgeUrl}
                onChange={(e) => setBridgeUrl(e.target.value)}
                placeholder="https://ais-dev-xxxx-xxxxx.run.app"
                className="w-full bg-slate-950 border border-slate-850 p-3 rounded-xl text-xs font-mono font-bold text-white focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
              <p className="text-[10px] text-slate-500 leading-normal">
                Enter the Sandbox URL of your active AI Studio Dev environment or Shared Preview above.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setSavedBackendUrl("");
                  setBridgeUrl("");
                  setIsBridgeOpen(false);
                  window.location.reload();
                }}
                className="px-4 py-2 border border-slate-805 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Reset To Default
              </button>
              <button
                onClick={() => {
                  setSavedBackendUrl(bridgeUrl);
                  setIsBridgeOpen(false);
                  window.location.reload();
                }}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-orange-500/10 transition-colors cursor-pointer"
              >
                Save & Sync Connection
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-[200] max-w-sm bg-slate-900 border border-slate-700/80 p-4 rounded-2xl shadow-[0_20px_40px_-5px_rgba(0,0,0,0.5)] flex items-center gap-3 animate-slide-in text-white text-xs font-bold leading-normal">
          <div className="w-2.5 h-2.5 bg-orange-500 rounded-full animate-ping shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
