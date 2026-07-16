import React, { useState } from "react";
import { Language, Driver, TRUCK_TYPES } from "../types";
import { Ship, Globe, User, Lock, Phone, Truck, ClipboardSignature, KeyRound, Mail, LogIn, LifeBuoy, CheckCircle2 } from "lucide-react";
import { signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification } from "firebase/auth";
import { auth, googleSignIn } from "../googleAuth";
import { apiFetch } from "../lib/api";
import PasswordInput from "./PasswordInput";

// Google Login is not approved for MVP. The button is hidden but the
// OAuth handler/backend below are kept intact so this can be flipped
// back on without redoing the integration.
const GOOGLE_LOGIN_ENABLED = false;

interface LoginPageProps {
  lang: Language;
  onSetLang: (lang: Language) => void;
  onLoginSuccess: (session: { role: "admin" | "driver" | "client"; email?: string; driver?: Driver | null; client?: any; loginType?: "firebase" | "local"; token?: string; adminType?: string }) => void;
  onViewPrivacy?: () => void;
  onViewTerms?: () => void;
}

const SUPPORT_EMAIL = "support@etir.app";
// Only used to route a Firebase-authenticated identity to the right
// verify-session role hint (see handleLogin) — never to grant access.
// Actual admin authorization always comes from the server session.
const OWNER_EMAIL = "sardar@maras.iq";

/** eTIR/MARAS brand icon + wordmark, sized for the compact mobile header or the large desktop panel. */
function BrandMark({ brand, tagline, size = "sm" }: { brand: string; tagline: string; size?: "sm" | "lg" }) {
  const isLarge = size === "lg";
  return (
    <div className={`flex flex-col ${isLarge ? "items-start text-start" : "items-center text-center"}`}>
      <div className={`${isLarge ? "p-4 rounded-2xl mb-4" : "p-3 rounded-2xl mb-3"} bg-blue-600 text-white shadow-lg shadow-blue-600/20 inline-flex`}>
        <Ship className={isLarge ? "w-9 h-9" : "w-7 h-7"} />
      </div>
      <h1 className={`${isLarge ? "text-3xl" : "text-xl"} font-black text-white tracking-tight`}>{brand}</h1>
      <p className={`${isLarge ? "text-sm mt-1.5" : "text-xs mt-0.5"} font-semibold text-blue-400 uppercase tracking-wider`}>{tagline}</p>
    </div>
  );
}

export default function LoginPage({ lang, onSetLang, onLoginSuccess, onViewPrivacy, onViewTerms }: LoginPageProps) {
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);

  // Login inputs
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isResettingPassword, setResettingPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Registration inputs
  const [regFullName, setRegFullName] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regTruckId, setRegTruckId] = useState("");
  const [regTruckType, setRegTruckType] = useState("reefer");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [regError, setRegError] = useState<React.ReactNode | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  const t = {
    en: {
      brand: "eTIR by MARAS",
      tagline: "Logistics Control Platform",
      subtitle: "Sign in to continue",
      identifierLabel: "Email / Phone / Username",
      identifierPlaceholder: "Email, phone, or username",
      passwordLabel: "Password",
      showPassword: "Show password",
      hidePassword: "Hide password",
      confirmPassword: "Confirm Password",
      passwordMismatch: "Passwords do not match.",
      signIn: "Sign In",
      signingIn: "Signing in...",
      forgotPassword: "Forgot password?",
      sendingReset: "Sending link...",
      needHelp: "Need help?",
      registerBtn: "Register as Driver",
      backToLogin: "Back to Sign In",
      fullName: "Full Name",
      regUsername: "Username ID (No spaces)",
      personalEmail: "Personal Email Address",
      emailPlaceholder: "e.g. driver@gmail.com",
      phone: "Mobile Phone (e.g. +90/964)",
      truckId: "Truck ID / Plate Number (e.g. 34-MAR-1903)",
      truckType: "Truck Type / Class",
      submitReg: "Complete Registration",
      creatingAccount: "Creating transport profile...",
      errorFields: "Please fill in all required fields.",
      genericLoginError: "Invalid username or password.",
      identifierRequired: "Please enter your username or email address first to get a password reset link.",
      resetSuccess: (email: string) => `A password reset link has been sent to ${email}. Please check your inbox and spam folder.`,
      resetFailed: "Could not send the reset link. Please try again.",
      unavailable: "The server is temporarily unavailable. Please try again shortly.",
      driverRegHeader: "Driver Self-Registration",
      driverRegDesc: "Register your vehicle to accept international freight manifests.",
      googleSignIn: "Sign in with Google",
      orDivider: "or",
      desktopHeadline: "Run your fleet with confidence.",
      desktopBullet1: "Real-time shipment and driver visibility",
      desktopBullet2: "Secure, role-based access for every team",
      desktopBullet3: "Built for international freight operations",
    },
    tr: {
      brand: "eTIR by MARAS",
      tagline: "Lojistik Kontrol Platformu",
      subtitle: "Devam etmek için giriş yapın",
      identifierLabel: "E-posta / Telefon / Kullanıcı Adı",
      identifierPlaceholder: "E-posta, telefon veya kullanıcı adı",
      passwordLabel: "Şifre",
      showPassword: "Şifreyi göster",
      hidePassword: "Şifreyi gizle",
      confirmPassword: "Şifreyi Onayla",
      passwordMismatch: "Şifreler eşleşmiyor.",
      signIn: "Giriş Yap",
      signingIn: "Giriş yapılıyor...",
      forgotPassword: "Şifremi unuttum?",
      sendingReset: "Gönderiliyor...",
      needHelp: "Yardıma mı ihtiyacınız var?",
      registerBtn: "Sürücü Olarak Kaydol",
      backToLogin: "Girişe Dön",
      fullName: "Adı Soyadı",
      regUsername: "Kullanıcı Adı (Boşluksuz)",
      personalEmail: "Kişisel E-posta Adresi",
      emailPlaceholder: "örn. surucu@gmail.com",
      phone: "İrtibat Telefonu (örn. +90/964)",
      truckId: "Tır Plakası / ID (örn. 34-MAR-1903)",
      truckType: "Tır / Dorse Sınıfı",
      submitReg: "Kaydı Tamamla",
      creatingAccount: "Sürücü profili oluşturuluyor...",
      errorFields: "Lütfen tüm zorunlu alanları doldurun.",
      genericLoginError: "Kullanıcı adı veya şifre hatalı.",
      identifierRequired: "Sıfırlama bağlantısı almak için önce kullanıcı adınızı veya e-posta adresinizi girin.",
      resetSuccess: (email: string) => `${email} adresine bir şifre sıfırlama bağlantısı gönderildi. Lütfen gelen kutunuzu ve spam klasörünüzü kontrol edin.`,
      resetFailed: "Sıfırlama bağlantısı gönderilemedi. Lütfen tekrar deneyin.",
      unavailable: "Sunucu şu anda kullanılamıyor. Lütfen kısa süre sonra tekrar deneyin.",
      driverRegHeader: "Sürücü Öz-Kayıt Portalı",
      driverRegDesc: "Uluslararası navlun belgelerini kabul etmek için aracınızı kaydedin.",
      googleSignIn: "Google ile Giriş Yap",
      orDivider: "veya",
      desktopHeadline: "Filonuzu güvenle yönetin.",
      desktopBullet1: "Gerçek zamanlı sevkiyat ve sürücü görünürlüğü",
      desktopBullet2: "Her ekip için güvenli, role dayalı erişim",
      desktopBullet3: "Uluslararası navliyat operasyonları için tasarlandı",
    },
    ar: {
      brand: "إيتير من MARAS",
      tagline: "منصة التحكم اللوجستي",
      subtitle: "سجّل الدخول للمتابعة",
      identifierLabel: "البريد الإلكتروني / الهاتف / اسم المستخدم",
      identifierPlaceholder: "البريد الإلكتروني أو الهاتف أو اسم المستخدم",
      passwordLabel: "كلمة المرور",
      showPassword: "إظهار كلمة المرور",
      hidePassword: "إخفاء كلمة المرور",
      confirmPassword: "تأكيد كلمة المرور",
      passwordMismatch: "كلمتا المرور غير متطابقتين.",
      signIn: "تسجيل الدخول",
      signingIn: "جاري تسجيل الدخول...",
      forgotPassword: "نسيت كلمة المرور؟",
      sendingReset: "جاري الإرسال...",
      needHelp: "هل تحتاج مساعدة؟",
      registerBtn: "تسجيل أخصائي نقل جديد",
      backToLogin: "العودة لتسجيل الدخول",
      fullName: "الاسم الكامل",
      regUsername: "اسم المستخدم (بدون مسافات)",
      personalEmail: "البريد الإلكتروني الشخصي",
      emailPlaceholder: "مثال: driver@gmail.com",
      phone: "رقم الهاتف المحمول (مثل +964)",
      truckId: "رقم شاحنة الشحن / اللوحة",
      truckType: "نوع وصنف الشاحنة",
      submitReg: "إكمال عملية التسجيل",
      creatingAccount: "جاري إنشاء ملف الناقل...",
      errorFields: "يرجى تعبئة جميع الحقول المطلوبة.",
      genericLoginError: "بيانات الدخول غير صحيحة.",
      identifierRequired: "يرجى إدخال اسم المستخدم أو البريد الإلكتروني أولاً لتلقي رابط إعادة التعيين.",
      resetSuccess: (email: string) => `تم إرسال رابط إعادة تعيين كلمة المرور إلى ${email}. يرجى التحقق من بريدك الإلكتروني ومجلد الرسائل غير المرغوب فيها.`,
      resetFailed: "تعذر إرسال رابط إعادة التعيين. يرجى المحاولة مرة أخرى.",
      unavailable: "الخادم غير متاح حالياً. يرجى المحاولة مرة أخرى بعد قليل.",
      driverRegHeader: "بوابة التسجيل الذاتي لأخصائي النقل",
      driverRegDesc: "سجل شاحنتك الآن للبدء في تلقي مستندات الشحن الدولية والرحلات.",
      googleSignIn: "تسجيل الدخول عبر Google",
      orDivider: "أو",
      desktopHeadline: "أدر أسطولك بثقة.",
      desktopBullet1: "رؤية فورية للشحنات والسائقين",
      desktopBullet2: "وصول آمن قائم على الأدوار لكل فريق",
      desktopBullet3: "مصمم لعمليات الشحن الدولي",
    }
  }[lang];

  const isRtl = lang === "ar";

  /** No "@" in the input is treated as a local username, e.g. a driver's short login name. */
  const resolveEmail = (identifier: string) => {
    const trimmed = identifier.trim().toLowerCase();
    return trimmed.includes("@") ? trimmed : `${trimmed}@etir.com`;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword) {
      setLoginError(t.errorFields);
      return;
    }

    setLoginError(null);
    setIsLoggingIn(true);

    try {
      // Force sign out any leftover session to prevent hijacking a
      // previous user's Firebase state.
      try {
        await auth.signOut();
      } catch (soErr) {
        console.warn("Sign out during login preparation failed:", soErr);
      }

      const identifier = loginUsername.trim();
      const enteredEmail = resolveEmail(identifier);

      // Single unified endpoint — the server alone decides whether this
      // identity is an admin, driver, or client. The client never chooses
      // a role; there is no role selector on this page.
      const res = await apiFetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: identifier, password: loginPassword })
      });

      const text = await res.text();
      const isHtml = text.trim().startsWith("<");

      if (isHtml) {
        setLoginError(t.unavailable);
        setIsLoggingIn(false);
        return;
      }

      if (res.ok) {
        const data = JSON.parse(text);
        onLoginSuccess({
          role: data.role,
          email: data.user?.email || enteredEmail,
          driver: data.driver || null,
          client: data.client || null,
          loginType: "local",
          token: data.token,
          adminType: data.adminType || data.user?.adminType
        });
        return;
      }

      // A rate-limit or pending/rejected-driver response is safe to show
      // verbatim — it tells the caller nothing they don't already know
      // about their own account. Everything else (wrong password, unknown
      // identity) must stay generic, so try the legacy Firebase fallback
      // below before ever surfacing a message.
      if (res.status === 429 || res.status === 403) {
        try {
          const errData = JSON.parse(text);
          if (errData?.error) {
            setLoginError(errData.error);
            setIsLoggingIn(false);
            return;
          }
        } catch {}
      }

      // Fallback for identities that predate local password login (the
      // owner account before SUPER_ADMIN_PASSWORD_HASH is configured, or
      // drivers who signed up before this app had its own password store).
      try {
        const userCredential = await signInWithEmailAndPassword(auth, enteredEmail, loginPassword);
        const user = userCredential.user;

        if (user && !user.emailVerified) {
          try { await sendEmailVerification(user); } catch (verErr) {
            console.warn("Could not resend verification email:", verErr);
          }
          await auth.signOut();
          setVerificationEmail(user.email || enteredEmail);
          setIsLoggingIn(false);
          return;
        }

        const isOwner = (user.email || "").toLowerCase() === OWNER_EMAIL;
        const verifyRes = await apiFetch("/api/verify-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: isOwner ? "admin" : "driver", idToken: await user.getIdToken() })
        });

        if (!verifyRes.ok) {
          await auth.signOut();
          setLoginError(t.genericLoginError);
          setIsLoggingIn(false);
          return;
        }

        const verifyData = await verifyRes.json();
        if (isOwner) {
          onLoginSuccess({
            role: "admin",
            email: OWNER_EMAIL,
            driver: null,
            loginType: "firebase",
            token: verifyData?.token,
            adminType: verifyData?.adminType || verifyData?.user?.adminType
          });
        } else {
          onLoginSuccess({
            role: "driver",
            driver: verifyData?.driver || null,
            loginType: "firebase",
            token: verifyData?.token
          });
        }
        return;
      } catch (authErr: any) {
        console.warn("Firebase Auth fallback failed:", authErr?.code || authErr);
        setLoginError(t.genericLoginError);
      }
    } catch (err: any) {
      console.error(err);
      setLoginError(t.genericLoginError);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!loginUsername.trim()) {
      setLoginError(t.identifierRequired);
      return;
    }
    const targetEmail = resolveEmail(loginUsername);
    try {
      setResettingPassword(true);
      await sendPasswordResetEmail(auth, targetEmail);
      setLoginError(t.resetSuccess(targetEmail));
    } catch (err: any) {
      setLoginError(t.resetFailed);
    } finally {
      setResettingPassword(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const res = await googleSignIn();
      if (!res) {
        setIsLoggingIn(false);
        return;
      }
      const user = res.user;
      const isOwner = (user.email || "").toLowerCase() === OWNER_EMAIL;

      let sessionToken: string | undefined;
      let foundDriver: Driver | null = null;
      let adminType: string | undefined;

      try {
        const verifyRes = await apiFetch("/api/verify-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: isOwner ? "admin" : "driver", idToken: await user.getIdToken() })
        });
        if (verifyRes.ok) {
          const verifyData = await verifyRes.json();
          sessionToken = verifyData?.token;
          foundDriver = verifyData?.driver || null;
          adminType = verifyData?.adminType || verifyData?.user?.adminType;
        }
      } catch (verifyErr) {
        console.warn("verify-session lookup failed:", verifyErr);
      }

      if (isOwner) {
        if (!sessionToken) {
          setLoginError(t.genericLoginError);
          await auth.signOut();
          setIsLoggingIn(false);
          return;
        }
        onLoginSuccess({ role: "admin", email: OWNER_EMAIL, driver: null, loginType: "firebase", token: sessionToken, adminType });
        return;
      }

      // Google Sign-In intentionally does not auto-create a new driver
      // account. It only works for drivers who already exist (found above
      // via verify-session) — new drivers must use the registration form,
      // which collects their real name/phone/truck info and correctly
      // enters the pending-approval queue.
      if (!foundDriver || !sessionToken) {
        setLoginError(
          lang === "tr"
            ? "Bu Google hesabı onaylı bir sürücü hesabına bağlı değil. Lütfen sürücü kayıt formunu kullanın."
            : (lang === "ar"
              ? "حساب Google هذا غير مرتبط بحساب سائق معتمد. يرجى استخدام نموذج تسجيل السائق."
              : "This Google account is not linked to an existing approved driver account. Please use the driver registration form instead.")
        );
        await auth.signOut();
        setIsLoggingIn(false);
        return;
      }

      onLoginSuccess({ role: "driver", driver: foundDriver, loginType: "firebase", token: sessionToken });
    } catch (e: any) {
      if (e?.code === 'auth/popup-closed-by-user' || e?.message?.includes('popup-closed-by-user')) {
        console.warn("Google authentication popup closed by user.");
      } else {
        setLoginError(t.genericLoginError);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!regFullName.trim() || !regUsername.trim() || !regEmail.trim() || !regPhone.trim() || !regTruckId.trim() || !regPassword) {
      setRegError(t.errorFields);
      return;
    }

    if (!regEmail.trim().includes("@")) {
      setRegError(lang === "tr" ? "Lütfen geçerli bir e-posta adresi girin" : lang === "ar" ? "يرجى إدخال بريد إلكتروني شخصي صالح" : "Please enter a valid personal email address.");
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setRegError(t.passwordMismatch);
      return;
    }

    setRegError(null);
    setIsRegistering(true);

    try {
      // Force sign out any existing session (like Admin) to prevent session hijacking
      try {
        await auth.signOut();
      } catch (soErr) {
        console.warn("Sign out during registration preparation failed:", soErr);
      }

      const email = regEmail.trim().toLowerCase();

      if (regPassword.length < 6) {
        setRegError("Password must be at least 6 characters.");
        setIsRegistering(false);
        return;
      }

      const registerRes = await apiFetch("/api/drivers/self-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: undefined,
          name: regFullName.trim(),
          username: regUsername.trim().replace(/\s+/g, "_"),
          email: email,
          password: regPassword,
          phone: regPhone.trim(),
          truckNumber: regTruckId.trim(),
          truckType: regTruckType
        })
      });

      if (registerRes.ok) {
        const text = await registerRes.text();
        if (text.trim().startsWith("<")) {
          throw new Error(t.unavailable);
        }
        setVerificationEmail(email);
      } else {
        const text = await registerRes.text();
        if (text.trim().startsWith("<")) {
          throw new Error(t.unavailable);
        }
        const errData = JSON.parse(text);
        setRegError(errData.error || "Registration failed on database side");
      }
    } catch (err: any) {
      console.error("Registration error:", err);
      setRegError(err.message || "Registration failed");
    } finally {
      setIsRegistering(false);
    }
  };

  const inputBaseClasses = "w-full h-[52px] ps-11 pe-4 bg-slate-900 border border-slate-800 hover:border-slate-700 focus:border-blue-500 rounded-xl text-base text-slate-100 placeholder-slate-500 font-medium focus:outline-none transition-all text-start";
  const passwordInputClasses = inputBaseClasses.replace("pe-4", "pe-11");
  const passwordToggleClasses = "absolute end-3.5 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center text-slate-500 hover:text-slate-300 cursor-pointer bg-transparent border-0 p-0";
  const regFieldBase = "w-full h-12 ps-9 pe-3 bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg text-sm text-slate-100 placeholder-slate-500 font-semibold focus:outline-none text-start";
  const regFieldMono = regFieldBase.replace("font-semibold", "font-mono");

  return (
    <div className="min-h-dvh w-full bg-slate-900 text-slate-100 font-sans lg:grid lg:grid-cols-2" dir={isRtl ? "rtl" : "ltr"}>

      {/* Desktop/tablet-landscape brand panel — logistics identity + messaging, not just a stretched form */}
      <div className="hidden lg:flex relative flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 border-e border-slate-800 px-12 py-14">
        <div aria-hidden="true" className="absolute -top-24 -start-24 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div aria-hidden="true" className="absolute bottom-0 end-0 w-[28rem] h-[28rem] bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10">
          <BrandMark brand={t.brand} tagline={t.tagline} size="lg" />
        </div>

        <div className="relative z-10 max-w-md space-y-6">
          <h2 className="text-3xl font-black text-white tracking-tight leading-tight">{t.desktopHeadline}</h2>
          <ul className="space-y-4">
            {[t.desktopBullet1, t.desktopBullet2, t.desktopBullet3].map((line) => (
              <li key={line} className="flex items-start gap-3 text-sm text-slate-300 font-medium">
                <CheckCircle2 className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">{t.tagline}</p>
      </div>

      {/* Auth column — full-viewport native-app surface on mobile, right-hand column on desktop */}
      <div className="relative overflow-hidden flex flex-col min-h-dvh lg:min-h-screen">
        {/* Decorative ambient blobs (mobile/tablet only — desktop has its own panel) */}
        <div aria-hidden="true" className="lg:hidden absolute top-10 start-10 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div aria-hidden="true" className="lg:hidden absolute bottom-10 end-10 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>

        {/* Top bar: language switcher, safe-area aware */}
        <div className="relative z-10 flex items-center justify-end px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-2 sm:px-8 lg:px-12 lg:pt-10">
          <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-2 rounded-lg border border-slate-800 text-xs font-bold text-slate-300 min-h-11">
            <Globe className="w-4 h-4 text-slate-400" />
            <select
              value={lang}
              onChange={(e) => onSetLang(e.target.value as Language)}
              className="bg-transparent text-white outline-none cursor-pointer text-xs"
              aria-label="Language"
            >
              <option value="en" className="bg-slate-950 text-white">EN</option>
              <option value="tr" className="bg-slate-950 text-white">TR</option>
              <option value="ar" className="bg-slate-950 text-white">AR</option>
            </select>
          </div>
        </div>

        {/* Content — normal document flow so the page (not a nested container) scrolls,
            and the keyboard can open without ever hiding the submit button below the fold. */}
        <div className="relative z-10 flex-1 flex flex-col lg:justify-center px-5 sm:px-8 lg:px-12 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="w-full mx-auto lg:max-w-md lg:bg-slate-950/60 lg:backdrop-blur-md lg:border lg:border-slate-800 lg:rounded-3xl lg:p-10 lg:shadow-2xl">

            {/* Compact brand mark — desktop already shows the large one in the left panel */}
            <div className="lg:hidden mb-6">
              <BrandMark brand={t.brand} tagline={t.tagline} size="sm" />
            </div>

            {verificationEmail ? (
              /* EMAIL VERIFICATION SCREEN */
              <div className="space-y-6 text-center">
                <div className="mx-auto w-16 h-16 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-full flex items-center justify-center animate-pulse">
                  <Mail className="w-8 h-8 text-blue-400" />
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-black text-white tracking-tight">
                    {lang === "en" ? "Registration Received" : lang === "tr" ? "Kayıt Alındı" : "تم استلام التسجيل"}
                  </h3>
                  <p className="text-sm text-slate-300 leading-relaxed font-semibold">
                    {lang === "en"
                      ? <>Registration received for <span className="text-blue-400 font-bold">{verificationEmail}</span>. Your account is pending admin approval — you will be able to sign in once an admin approves it.</>
                      : lang === "tr"
                        ? <><span className="text-blue-400 font-bold">{verificationEmail}</span> için kayıt alındı. Hesabınız yönetici onayı bekliyor — bir yönetici onayladıktan sonra giriş yapabileceksiniz.</>
                        : <>تم استلام التسجيل لـ <span className="text-blue-400 font-bold">{verificationEmail}</span>. حسابك بانتظار موافقة المسؤول — ستتمكن من تسجيل الدخول بعد الموافقة عليه.</>
                    }
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setVerificationEmail(null);
                    setIsRegisterMode(false);
                  }}
                  className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-white font-bold text-base rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <KeyRound className="w-4 h-4 shrink-0" />
                  <span>{lang === "en" ? "Back to Sign In" : lang === "tr" ? "Girişe Dön" : "العودة لتسجيل الدخول"}</span>
                </button>
              </div>
            ) : !isRegisterMode ? (
              /* LOGIN FORM */
              <div className="space-y-5">
                <h2 className="text-2xl lg:text-[28px] font-black text-white tracking-tight text-center lg:text-start mb-1">{t.subtitle}</h2>

                {loginError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold rounded-xl text-center" role="alert">
                    {loginError}
                  </div>
                )}

                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="login-identifier" className="text-[11px] uppercase tracking-wider font-bold text-slate-400 block text-start">
                      {t.identifierLabel}
                    </label>
                    <div className="relative">
                      <User className="absolute start-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        id="login-identifier"
                        type="text"
                        autoComplete="username"
                        required
                        placeholder={t.identifierPlaceholder}
                        value={loginUsername}
                        onChange={(e) => setLoginUsername(e.target.value)}
                        className={inputBaseClasses}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center gap-2">
                      <label htmlFor="login-password" className="text-[11px] uppercase tracking-wider font-bold text-slate-400 block text-start">
                        {t.passwordLabel}
                      </label>
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={isResettingPassword}
                        className="text-[11px] text-blue-400 hover:text-blue-300 font-bold hover:underline bg-transparent border-0 cursor-pointer p-1 -m-1 disabled:opacity-60"
                      >
                        {isResettingPassword ? t.sendingReset : t.forgotPassword}
                      </button>
                    </div>
                    <PasswordInput
                      id="login-password"
                      autoComplete="current-password"
                      required
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      inputClassName={passwordInputClasses}
                      toggleClassName={passwordToggleClasses}
                      leadingIcon={<Lock className="absolute start-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />}
                      showLabel={t.showPassword}
                      hideLabel={t.hidePassword}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    className="w-full h-14 text-white font-bold text-base rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer mt-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-70 shadow-blue-600/20"
                  >
                    {isLoggingIn ? (
                      <span>{t.signingIn}</span>
                    ) : (
                      <>
                        <LogIn className="w-5 h-5 shrink-0" />
                        <span>{t.signIn}</span>
                      </>
                    )}
                  </button>
                </form>

                {GOOGLE_LOGIN_ENABLED && (
                  <>
                    <div className="relative flex py-1 items-center">
                      <div className="flex-grow border-t border-slate-900"></div>
                      <span className="flex-shrink mx-4 text-[10px] text-slate-500 font-bold uppercase tracking-wider">{t.orDivider}</span>
                      <div className="flex-grow border-t border-slate-900"></div>
                    </div>

                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={isLoggingIn}
                      className="w-full h-12 bg-slate-900 hover:bg-slate-800 hover:text-white text-slate-300 font-bold text-sm rounded-xl border border-slate-800 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22c-.22-.67-.35-1.37-.35-2.07z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                      </svg>
                      <span>{t.googleSignIn}</span>
                    </button>
                  </>
                )}

                <div className="border-t border-slate-800 pt-4">
                  <button
                    onClick={() => {
                      setIsRegisterMode(true);
                      setRegError(null);
                    }}
                    className="w-full h-12 bg-slate-900 hover:bg-slate-800 hover:text-white text-slate-300 font-bold text-sm rounded-xl border border-slate-800 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ClipboardSignature className="w-4 h-4 text-blue-400 shrink-0" />
                    <span>{t.registerBtn}</span>
                  </button>
                </div>

                {/* Support + legal footer */}
                <div className="border-t border-slate-900 pt-4 pb-2 flex flex-col items-center justify-center gap-3 text-[11px] text-slate-500">
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="flex items-center gap-1.5 hover:text-blue-400 transition-all py-1"
                  >
                    <LifeBuoy className="w-3.5 h-3.5 shrink-0" />
                    <span>{t.needHelp} <span className="font-semibold">{SUPPORT_EMAIL}</span></span>
                  </a>
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-2">
                    {onViewPrivacy && (
                      <button
                        type="button"
                        onClick={onViewPrivacy}
                        className="hover:text-blue-400 transition-all cursor-pointer underline hover:no-underline font-semibold uppercase tracking-wider outline-none p-1 -m-1 bg-transparent border-0"
                      >
                        {lang === "tr" ? "Gizlilik Politikası" : lang === "ar" ? "سياسة الخصوصية" : "Privacy Policy"}
                      </button>
                    )}
                    {onViewPrivacy && onViewTerms && <span className="text-slate-700">|</span>}
                    {onViewTerms && (
                      <button
                        type="button"
                        onClick={onViewTerms}
                        className="hover:text-blue-400 transition-all cursor-pointer underline hover:no-underline font-semibold uppercase tracking-wider outline-none p-1 -m-1 bg-transparent border-0"
                      >
                        {lang === "tr" ? "Kullanım Koşulları" : lang === "ar" ? "الشروط والأحكام" : "Terms & Conditions"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* REGISTRATION FORM */
              <div className="space-y-5">
                <div className="space-y-1">
                  <h2 className="text-xl font-black text-white tracking-tight text-center lg:text-start">{t.driverRegHeader}</h2>
                  <p className="text-xs text-slate-400 text-center lg:text-start">{t.driverRegDesc}</p>
                </div>

                {regError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold rounded-xl text-center">
                    {regError}
                  </div>
                )}

                <form onSubmit={handleRegister} className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block text-start">
                      {t.fullName}
                    </label>
                    <div className="relative">
                      <User className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. Mehmet Aksoy"
                        value={regFullName}
                        onChange={(e) => setRegFullName(e.target.value)}
                        className={regFieldBase}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block text-start">
                      {t.regUsername}
                    </label>
                    <div className="relative">
                      <User className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. mehmet_aksoy"
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value)}
                        className={regFieldMono}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block text-start">
                      {t.personalEmail}
                    </label>
                    <div className="relative">
                      <Mail className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="email"
                        required
                        placeholder={t.emailPlaceholder}
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        className={regFieldBase}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block text-start">
                      {t.phone}
                    </label>
                    <div className="relative">
                      <Phone className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. +90 532 999 8877"
                        value={regPhone}
                        onChange={(e) => setRegPhone(e.target.value)}
                        className={regFieldBase}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block text-start">
                      {t.truckId}
                    </label>
                    <div className="relative">
                      <Truck className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. 34-LOG-2026"
                        value={regTruckId}
                        onChange={(e) => setRegTruckId(e.target.value)}
                        className={regFieldMono}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block text-start">
                      {t.truckType}
                    </label>
                    <div className="relative">
                      <select
                        value={regTruckType}
                        onChange={(e) => setRegTruckType(e.target.value)}
                        className="w-full h-12 px-3 bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg text-sm text-slate-100 font-semibold focus:outline-none text-start cursor-pointer"
                      >
                        {TRUCK_TYPES.map(type => (
                          <option key={type.id} value={type.id} className="bg-slate-950 text-white">
                            {lang === 'en' ? type.en : (lang === 'tr' ? type.tr : type.ar)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block text-start">
                      {t.passwordLabel}
                    </label>
                    <PasswordInput
                      required
                      placeholder="••••••••"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      inputClassName="w-full h-12 ps-9 pe-9 bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg text-sm text-slate-100 placeholder-slate-500 font-mono focus:outline-none text-start"
                      toggleClassName="absolute end-3 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center text-slate-500 hover:text-slate-300 cursor-pointer bg-transparent border-0 p-0"
                      leadingIcon={<KeyRound className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />}
                      showLabel={t.showPassword}
                      hideLabel={t.hidePassword}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block text-start">
                      {t.confirmPassword}
                    </label>
                    <PasswordInput
                      required
                      placeholder="••••••••"
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      inputClassName="w-full h-12 ps-9 pe-9 bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg text-sm text-slate-100 placeholder-slate-500 font-mono focus:outline-none text-start"
                      toggleClassName="absolute end-3 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center text-slate-500 hover:text-slate-300 cursor-pointer bg-transparent border-0 p-0"
                      leadingIcon={<KeyRound className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />}
                      showLabel={t.showPassword}
                      hideLabel={t.hidePassword}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isRegistering}
                    className="w-full h-14 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-base rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
                  >
                    {isRegistering ? (
                      <span>{t.creatingAccount}</span>
                    ) : (
                      <>
                        <ClipboardSignature className="w-4 h-4 shrink-0" />
                        <span>{t.submitReg}</span>
                      </>
                    )}
                  </button>
                </form>

                <button
                  onClick={() => {
                    setIsRegisterMode(false);
                    setRegError(null);
                  }}
                  className="w-full min-h-11 py-2 text-slate-400 hover:text-white font-bold text-xs bg-transparent transition-all flex items-center justify-center gap-1 cursor-pointer"
                >
                  <span>{isRtl ? "→" : "←"} {t.backToLogin}</span>
                </button>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
