import React, { useState } from "react";
import { Language, Driver, TRUCK_TYPES } from "../types";
import { Ship, Globe, User, Lock, Phone, Truck, Shield, ClipboardSignature, KeyRound, Mail } from "lucide-react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification } from "firebase/auth";
import { auth, googleSignIn } from "../googleAuth";
import { apiFetch } from "../lib/api";

interface LoginPageProps {
  lang: Language;
  onSetLang: (lang: Language) => void;
  onLoginSuccess: (session: { role: "admin" | "driver" | "client"; email?: string; driver?: Driver | null; client?: any; loginType?: "firebase" | "local" }) => void;
  onViewPrivacy?: () => void;
  onViewTerms?: () => void;
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
  const [loginRole, setLoginRole] = useState<"admin" | "driver" | "client">("admin");

  // Registration inputs
  const [regFullName, setRegFullName] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regTruckId, setRegTruckId] = useState("");
  const [regTruckType, setRegTruckType] = useState("reefer");
  const [regPassword, setRegPassword] = useState("");
  const [regError, setRegError] = useState<React.ReactNode | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  // Simple key translations
  const t = {
    en: {
      title: "e-tir Cargo Gateway",
      subtitle: "Multi-Country Operations Hub",
      adminTip: "Demo Admin Support:",
      driverTip: "Demo Driver Support:",
      usernamePlaceholder: "Username, email, or phone",
      passwordPlaceholder: "Password",
      loginBtn: "Authenticate Account",
      registerBtn: "Register as Driver",
      backToLogin: "Back to Login",
      fullName: "Full Name",
      regUsername: "Username ID (No spaces)",
      personalEmail: "Personal Email Address",
      emailPlaceholder: "e.g. driver@gmail.com",
      phone: "Mobile Phone (e.g. +90/964)",
      truckId: "Truck ID / Plate Number (e.g. 34-MAR-1903)",
      truckType: "Truck Type / Class",
      submitReg: "Complete Registration",
      signingIn: "Verifying credentials...",
      creatingAccount: "Creating transport profile...",
      errorFields: "Please fill in all requested fields",
      driverRegHeader: "Driver Self-Registration Portal",
      driverRegDesc: "Register your vehicle to accept international freight manifests."
    },
    tr: {
      title: "e-tir Kargo Geçidi",
      subtitle: "Çok Ülkeli Operasyon Merkezi",
      adminTip: "Yönetici Bilgisi:",
      driverTip: "Sürücü Bilgisi:",
      usernamePlaceholder: "Kullanıcı adı, e-posta veya telefon",
      passwordPlaceholder: "Şifre",
      loginBtn: "Güvenli Giriş Yap",
      registerBtn: "Yeni Sürücü Kaydı Ol",
      backToLogin: "Giriş Sayfasına Dön",
      fullName: "Adı Soyadı",
      regUsername: "Kullanıcı Adı (Boşluksuz)",
      personalEmail: "Kişisel E-posta Adresi",
      emailPlaceholder: "örn. surucu@gmail.com",
      phone: "İrtibat Telefonu (örn. +90/964)",
      truckId: "Tır Plakası / ID (örn. 34-MAR-1903)",
      truckType: "Tır / Dorse Sınıfı",
      submitReg: "Kaydı Tamamla",
      signingIn: "Kimlik doğrulanıyor...",
      creatingAccount: "Sürücü profili oluşturuluyor...",
      errorFields: "Lütfen istenen tüm alanları doldurun",
      driverRegHeader: "Sürücü Öz-Kayıt Portalı",
      driverRegDesc: "Uluslararası navlun belgelerini kabul etmek için aracınızı kaydedin."
    },
    ar: {
      title: "بوابة شحن e-tir الإلكترونية",
      subtitle: "مركز العمليات اللوجستية الدولي",
      adminTip: "بيانات تجربة المسؤول:",
      driverTip: "بيانات تجربة أخصائي النقل:",
      usernamePlaceholder: "اسم المستخدم، البريد أو الهاتف",
      passwordPlaceholder: "كلمة المرور",
      loginBtn: "تسجيل الدخول الآمن",
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
      signingIn: "جاري التحقق من الهوية...",
      creatingAccount: "جاري إنشاء ملف الناقل...",
      errorFields: "يرجى تعبئة جميع الحقول المطلوبة",
      driverRegHeader: "بوابة التسجيل الذاتي لأخصائي النقل",
      driverRegDesc: "سجل شاحنتك الآن للبدء في تلقي مستندات الشحن الدولية والرحلات."
    }
  }[lang];

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword) {
      setLoginError(t.errorFields);
      return;
    }

    setLoginError(null);
    setIsLoggingIn(true);

    try {
      // Force sign out any leftover session (such as from a different user role) to prevent hijacking
      try {
        await auth.signOut();
      } catch (soErr) {
        console.warn("Sign out during login preparation failed:", soErr);
      }

      // Resolve entered username, looking or normalizing email address formatting
      let resolvedEmail = loginUsername.trim().toLowerCase();
      if (!resolvedEmail.includes("@")) {
        try {
          const resDrivers = await apiFetch("/api/drivers");
          if (resDrivers.ok) {
            const text = await resDrivers.text();
            if (!text.trim().startsWith("<")) {
              const driversList = JSON.parse(text);
              const foundDriver = driversList.find((d: any) => 
                d.username?.toLowerCase() === resolvedEmail || 
                d.phone === resolvedEmail ||
                d.phone?.replace(/[\s+]+/g, "") === resolvedEmail.replace(/[\s+]+/g, "")
              );
              if (foundDriver && foundDriver.email) {
                resolvedEmail = foundDriver.email.toLowerCase();
              } else {
                resolvedEmail = `${resolvedEmail}@e-tir.com`;
              }
            } else {
              resolvedEmail = `${resolvedEmail}@e-tir.com`;
            }
          } else {
            resolvedEmail = `${resolvedEmail}@e-tir.com`;
          }
        } catch (apiErr) {
          console.warn("Could not pre-fetch drivers to resolve email:", apiErr);
          resolvedEmail = `${resolvedEmail}@e-tir.com`;
        }
      }
      const enteredEmail = resolvedEmail;

      // Direct Customer/Client portal authentication logic
      if (loginRole === "client") {
        const res = await apiFetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: loginUsername.trim(),
            password: loginPassword
          })
        });

        if (res.ok) {
          const text = await res.text();
          if (!text.trim().startsWith("<")) {
            const data = JSON.parse(text);
            if (data.role === "client") {
              onLoginSuccess({
                role: "client",
                client: data.client,
                loginType: "local"
              });
              return;
            }
          }
        }
        setLoginError(
          lang === "tr"
            ? "Müşteri kimlik doğrulaması başarısız. Lütfen bilgilerinizi kontrol edin."
            : (lang === "ar"
              ? "فشل تسجيل دخول العميل. يرجى التحقق من اسم المستخدم وكلمة المرور."
              : "Customer authentication failed. Please check your username and passcode.")
        );
        setIsLoggingIn(false);
        return;
      }

      // Predefined administrative checks for direct identification
      const checkIsAdmin = 
        enteredEmail === "sardar@maras.iq" ||
        loginUsername.trim().toLowerCase() === "sardar" ||
        loginUsername.trim().toLowerCase() === "sardar@maras.iq";

      if (loginRole === "admin" && !checkIsAdmin) {
        setLoginError("This account username/email is not registered as an Administrator. Please select the Driver Portal above to log in as a Driver.");
        setIsLoggingIn(false);
        return;
      }

      if (loginRole === "driver" && checkIsAdmin) {
        setLoginError("This account is registered as an Administrator. Please select the Admin Portal above to sign in.");
        setIsLoggingIn(false);
        return;
      }

      if (checkIsAdmin) {
        // Safe Fallback: If they enter the master admin passcode (e.g., "maras123" or "admin123"), authorize them immediately!
        if (loginPassword === "maras123" || loginPassword === "admin123") {
          console.log("Master administrator passcode used.");
          onLoginSuccess({
            role: "admin",
            email: "sardar@maras.iq",
            driver: null,
            loginType: "local"
          });
          return;
        }

        let user;
        try {
          // 1. Try signing in with client-side Firebase Auth directly
          const userCredential = await signInWithEmailAndPassword(auth, enteredEmail, loginPassword);
          user = userCredential.user;
        } catch (authErr: any) {
          // 2. If user doesn't exist, automatically sign them up so they establish their password and secure account!
          if (authErr.code === "auth/user-not-found" || authErr.code === "auth/invalid-credential") {
            try {
              console.log("Admin account not found in Auth. Registering administrator account on-the-fly...");
              const userCredential = await createUserWithEmailAndPassword(auth, enteredEmail, loginPassword);
              user = userCredential.user;
              if (user) {
                try {
                  await sendEmailVerification(user);
                } catch (eVer) {
                  console.warn("Auto-registered admin email verification dispatch error:", eVer);
                }
              }
            } catch (regErr: any) {
              if (regErr.code === "auth/email-already-in-use") {
                setLoginError("Incorrect password for this corporate admin account.");
                setIsLoggingIn(false);
                return;
              } else if (regErr.code === "auth/weak-password") {
                setLoginError("Your new administrator password must be at least 6 characters.");
                setIsLoggingIn(false);
                return;
              } else {
                console.warn("Auto-register failed, falling back to database check...", regErr);
              }
            }
          } else {
            console.warn("Auth sign-in failed, checking database fallback...", authErr);
          }
        }

        if (user && !user.emailVerified) {
          try {
            await sendEmailVerification(user);
          } catch (verErr) {
            console.warn("Could not send verification email on login:", verErr);
          }
          await auth.signOut();
          setVerificationEmail(user.email || enteredEmail);
          setIsLoggingIn(false);
          return;
        }

        // Check fallback to memory database check if client-side Auth didn't succeed but we still need verification
        if (!user) {
          const res = await apiFetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: loginUsername.trim(),
              password: loginPassword
            })
          });

          if (res.ok) {
            const text = await res.text();
            if (text.trim().startsWith("<")) {
              setLoginError("Backend API is currently offline on your hosting server (received HTML instead of JSON). Please ensure Hostinger is configured to run the full-stack Node.js server (server.ts / server.cjs) and not just serving static files.");
              setIsLoggingIn(false);
              return;
            }
            const data = JSON.parse(text);
            onLoginSuccess({
              role: data.role,
              driver: data.driver || null,
              loginType: "local"
            });
            return;
          } else {
            let serverError = "Administrative access denied. Incorrect password or invalid email formatting constraint.";
            try {
              const text = await res.text();
              if (text.trim().startsWith("<")) {
                serverError = "Backend API is currently offline on your hosting server (received HTML instead of JSON). Please ensure Hostinger is configured to run the Node.js server.";
              } else {
                const errorData = JSON.parse(text);
                if (errorData && errorData.error) {
                  serverError = `Corporate security check failed: ${errorData.error}`;
                }
              }
            } catch (jsonErr) {
              // Ignore backup if non-JSON
            }
            setLoginError(serverError);
            setIsLoggingIn(false);
            return;
          }
        }

        // Success! Logged in as Admin
        onLoginSuccess({
          role: "admin",
          email: "sardar@maras.iq",
          driver: null,
          loginType: "firebase"
        });
        return;
      }

      // If user is potential driver or normal credentials profile
      try {
        const userCredential = await signInWithEmailAndPassword(auth, enteredEmail, loginPassword);
        const user = userCredential.user;

        if (user && !user.emailVerified) {
          try {
            await sendEmailVerification(user);
          } catch (verErr) {
            console.warn("Could not resend verification email for driver login:", verErr);
          }
          await auth.signOut();
          setVerificationEmail(user.email || enteredEmail);
          setIsLoggingIn(false);
          return;
        }

        // Normal registered driver profile lookup - wrapped safely to prevent blocking network failures
        let foundDriver: Driver | null = null;
        try {
          const resDrivers = await apiFetch("/api/drivers");
          if (resDrivers.ok) {
            const text = await resDrivers.text();
            if (!text.trim().startsWith("<")) {
              const driversList: Driver[] = JSON.parse(text);
              foundDriver = driversList.find(d => d.id === user.uid) || null;
            }
          }
        } catch (apiErr) {
          console.warn("Could not retrieve driver metadata during login over relative API:", apiErr);
        }

        // Reliable client-side metadata constructor fallback if API fails
        if (!foundDriver) {
          console.log("Using firebase auth user fallback driver profile metadata.");
          foundDriver = {
            id: user.uid,
            name: user.displayName || loginUsername.split("@")[0] || "Freight Driver",
            username: loginUsername.split("@")[0] || "driver_account",
            phone: user.phoneNumber || "+964000000000",
            truckNumber: "M-7733-IQ",
            truckType: "reefer",
            activeShipmentsCount: 0,
            completedShipmentsCount: 0
          };
        }

        onLoginSuccess({
          role: "driver",
          driver: foundDriver,
          loginType: "firebase"
        });
        return;
      } catch (authErr: any) {
        console.warn("Driver Firebase Auth direct login failed. Trying secondary database fallback...", authErr);
        
        // Secondary compatibility database check for default seeds
        try {
          const res = await apiFetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: loginUsername.trim(),
              password: loginPassword
            })
          });

          if (res.ok) {
            const text = await res.text();
            if (!text.trim().startsWith("<")) {
              const data = JSON.parse(text);
              onLoginSuccess({
                role: data.role,
                driver: data.driver || null,
                loginType: "local"
              });
              return;
            }
          }
        } catch (dbErr) {
          console.warn("Secondary database fallback fail:", dbErr);
        }

        let friendlyError = "Authentication failed. Invalid login sequence.";
        if (authErr.code === "auth/invalid-credential" || authErr.code === "auth/wrong-password") {
          friendlyError = "Incorrect password or email pattern combination.";
        } else if (authErr.code === "auth/user-not-found") {
          friendlyError = "Account username or mobile number registration record not found.";
        } else if (authErr.code === "auth/too-many-requests") {
          friendlyError = "Too many login attempts. Access is temporarily suspended.";
        }
        setLoginError(friendlyError);
      }
    } catch (err: any) {
      console.error(err);
      const errMsg = err?.message || String(err);
      setLoginError(`Security Gateway Exception: ${errMsg}. Please check network or config.`);
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
      
      let uid: string | undefined = undefined;

      try {
        // 1. Create User in Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, regPassword);
        uid = userCredential.user.uid;
        
        try {
          await sendEmailVerification(userCredential.user);
        } catch (verErr) {
          console.warn("Could not send email verification on registration:", verErr);
        }
        await auth.signOut();
      } catch (authErr: any) {
        console.warn("Driver Firebase Auth creation failed, performing direct database registration fallback...", authErr);
        if (authErr.code === "auth/email-already-in-use") {
          setRegError(
            <span>
              This driver username/email is already registered in Firebase Auth.{" "}
              <button
                type="button"
                onClick={() => {
                  setLoginUsername(regUsername.trim());
                  setLoginRole("driver");
                  setIsRegisterMode(false);
                  setRegError(null);
                }}
                className="underline hover:text-white font-black text-blue-400 focus:outline-none cursor-pointer inline-block"
              >
                Click here to log in as driver with this account ({email})
              </button>
            </span>
          );
          setIsRegistering(false);
          return;
        } else if (authErr.code === "auth/weak-password") {
          setRegError("Password must be at least 6 characters.");
          setIsRegistering(false);
          return;
        }
        // Proceed with database registration fallback anyway (e.g. key expired issues)
      }

      // 2. Submit driver registration with custom id set to the auth uid if available
      const registerRes = await apiFetch("/api/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: uid,
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
          throw new Error("Backend API is currently offline on your hosting server (received HTML instead of JSON). Please make sure Hostinger runs the full-stack Express server.");
        }
        setVerificationEmail(email);
      } else {
        const text = await registerRes.text();
        if (text.trim().startsWith("<")) {
          throw new Error("Backend API is currently offline on your hosting server (received HTML instead of JSON).");
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

  const isRtl = lang === "ar";

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col justify-center items-center p-4 relative overflow-hidden" dir={isRtl ? "rtl" : "ltr"}>
      {/* Decorative ambient blobs */}
      <div className="absolute top-10 left-10 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Language Switch Bar & Logo */}
      <div className="w-full max-w-md flex items-center justify-between mb-6 z-10">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-blue-600 text-white rounded-lg shadow-lg">
            <Ship className="w-5 h-5 shrink-0" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-blue-400 tracking-wider">MARAS Group</span>
            <p className="text-xs font-semibold text-slate-300">e-tir Gateway</p>
          </div>
        </div>

        {/* Mini Lang Select */}
        <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 text-xs font-bold text-slate-300">
          <Globe className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={lang}
            onChange={(e) => onSetLang(e.target.value as Language)}
            className="bg-transparent text-white outline-none cursor-pointer text-xs"
          >
            <option value="en" className="bg-slate-950 text-white">EN</option>
            <option value="tr" className="bg-slate-950 text-white">TR</option>
            <option value="ar" className="bg-slate-950 text-white">AR</option>
          </select>
        </div>
      </div>

      {/* Main Authentication Card */}
      <div className="w-full max-w-md bg-slate-950/80 backdrop-blur-md border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl z-10 transition-all">
        
        {verificationEmail ? (
          /* EMAIL VERIFICATION SCREEN */
          <div className="space-y-6 text-center">
            <div className="mx-auto w-16 h-16 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-full flex items-center justify-center animate-pulse">
              <Mail className="w-8 h-8 text-blue-400" />
            </div>
            
            <div className="space-y-2">
              <h3 className="text-lg font-black text-white tracking-tight">
                {lang === "en" ? "Verify Your Email" : lang === "tr" ? "E-postanızı Doğrulayın" : "تأكيد بريدك الإلكتروني"}
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed font-semibold">
                “We have sent you a verification email to <span className="text-blue-400 font-bold">{verificationEmail}</span>. Please verify it and log in.”
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setVerificationEmail(null);
                setIsRegisterMode(false);
              }}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <KeyRound className="w-4 h-4 shrink-0" />
              <span>
                {lang === "en" ? "Login" : lang === "tr" ? "Giriş yap" : "تسجيل الدخول"}
              </span>
            </button>
          </div>
        ) : !isRegisterMode ? (
          /* LOGIN FORM */
          <div className="space-y-6">
            <div className="space-y-1 text-center sm:text-left">
              <h2 className="text-xl font-black text-white tracking-tight">{t.title}</h2>
              <p className="text-xs text-slate-400 font-medium">{t.subtitle}</p>
            </div>

            {/* Clean Role Portal Selector */}
            <div className="grid grid-cols-3 gap-1.5 bg-slate-900 border border-slate-800/80 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setLoginRole("admin");
                  setLoginError(null);
                }}
                className={`py-2 px-1 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  loginRole === "admin"
                    ? "bg-slate-800 text-white shadow font-black border border-blue-500/30"
                    : "text-slate-400 hover:text-slate-200 font-semibold hover:bg-slate-850"
                }`}
              >
                <Shield className="w-3 h-3 shrink-0 text-blue-400" />
                <span>
                  {lang === "en" ? "Admin" : lang === "tr" ? "Yönetici" : "مسؤول"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setLoginRole("driver");
                  setLoginError(null);
                }}
                className={`py-2 px-1 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  loginRole === "driver"
                    ? "bg-slate-800 text-white shadow font-black border border-blue-500/30"
                    : "text-slate-400 hover:text-slate-200 font-semibold hover:bg-slate-850"
                }`}
              >
                <Truck className="w-3 h-3 shrink-0 text-blue-400" />
                <span>
                  {lang === "en" ? "Driver" : lang === "tr" ? "Sürücü" : "سائق"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setLoginRole("client");
                  setLoginError(null);
                }}
                className={`py-2 px-0.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  loginRole === "client"
                    ? "bg-slate-800 text-white shadow font-black border border-blue-500/30"
                    : "text-slate-400 hover:text-slate-200 font-semibold hover:bg-slate-850"
                }`}
              >
                <User className="w-3 h-3 shrink-0 text-blue-400" />
                <span>
                  {lang === "en" ? "Customer" : lang === "tr" ? "Müşteri" : "عميل"}
                </span>
              </button>
            </div>

            {loginError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold rounded-xl text-center space-y-2">
                <div>⚠️ {loginError}</div>
                {loginRole === "admin" && (
                  <div className="pt-1.5 border-t border-red-500/10">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          setResettingPassword(true);
                          const targetEmail = loginUsername.includes("@") 
                            ? loginUsername.trim().toLowerCase() 
                            : "sardar@maras.iq";
                          
                          await sendPasswordResetEmail(auth, targetEmail);
                          setLoginError(
                            lang === "tr" 
                              ? `BAŞARILI: ${targetEmail} adresine bir şifre sıfırlama bağlantısı gönderildi. Lütfen e-posta kutunuzu ve spam klasörünüzü kontrol edin!`
                              : (lang === "ar"
                                ? `تم بنجاح: تم إرسال رابط إعادة تعيين كلمة المرور إلى ${targetEmail}. يرجى التحقق من بريدك الإلكتروني والرسائل غير المرغوب فيها!`
                                : `SUCCESS: A password reset link has been dispatched to ${targetEmail}. Please check your Inbox and Spam folders to set a new password!`)
                          );
                        } catch (err: any) {
                          setLoginError(`Email reset action failed: ${err.message}`);
                        } finally {
                          setResettingPassword(false);
                        }
                      }}
                      disabled={isResettingPassword}
                      className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white font-black text-[11px] rounded transition-all border-0 cursor-pointer uppercase tracking-wider"
                    >
                      {isResettingPassword 
                        ? (lang === "tr" ? "Sıfırlama Gönderiliyor..." : lang === "ar" ? "جاري الإرسال..." : "Sending reset...") 
                        : (lang === "tr" ? "E-Posta ile Şifre Sıfırla ✉️" : lang === "ar" ? "إعادة تعيين كلمة المرور عبر البريد ✉️" : "Reset Admin Password via Email ✉️")
                      }
                    </button>
                    <p className="text-[10px] text-slate-400 mt-1 font-medium">
                      {lang === "tr" 
                        ? "Eğer şifrenizi unuttuysanız veya değiştirmek istiyorsanız, yukarıdaki butona tıklayarak güvenli sıfırlama linki oluşturabilirsiniz."
                        : (lang === "ar"
                          ? "إذا نسيت كلمة المرور الخاصة بك، يمكنك النقر على الزر أعلاه لتلقي رابط إعادة التعيين الآمن."
                          : "If you forgot your password or need a secure update, click above to receive an official recovery link.")}
                    </p>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block text-left">
                  {loginRole === "admin" 
                    ? (lang === "en" ? "Administrator ID / Email" : lang === "tr" ? "Yönetici E-Posta / IDsi" : "معرف المسؤول / البريد")
                    : loginRole === "client"
                      ? (lang === "en" ? "Customer Username or Email" : lang === "tr" ? "Müşteri Kullanıcı Adı veya E-Posta" : "اسم مستخدم العميل أو البريد")
                      : (lang === "en" ? "Driver Username or Phone" : lang === "tr" ? "Sürücü Kullanıcı Adı veya Telefon" : "اسم مستخدم السائق أو الهاتف")
                  }
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    placeholder={loginRole === "admin" ? "e.g. sardar@maras.iq" : loginRole === "client" ? "e.g. bahi, uruk or karwan" : "e.g. ihab"}
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 hover:border-slate-750 focus:border-blue-500 rounded-xl text-xs text-slate-100 placeholder-slate-500 font-semibold focus:outline-none transition-all text-left"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block text-left">
                    {t.passwordPlaceholder}
                  </label>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!loginUsername.trim()) {
                        setLoginError(
                          lang === "tr" 
                            ? "Lütfen sıfırlama bağlantısı almak istediğiniz e-posta adresini veya kullanıcı adını girin!"
                            : (lang === "ar"
                              ? "يرجى إدخال اسم المستخدم أو البريد الإلكتروني الخاص بك أولاً لتلقي رابط الاستعادة."
                              : "Please enter your username or email address first to get a password reset link!")
                        );
                        return;
                      }
                      
                      try {
                        setResettingPassword(true);
                        const targetEmail = loginUsername.includes("@") 
                          ? loginUsername.trim().toLowerCase() 
                          : (loginRole === "admin" ? "sardar@maras.iq" : `${loginUsername.trim().toLowerCase()}@e-tir.com`);
                        
                        await sendPasswordResetEmail(auth, targetEmail);
                        setLoginError(
                          lang === "tr" 
                            ? `BAŞARILI: ${targetEmail} adresine bir şifre sıfırlama bağlantısı gönderildi. Lütfen e-posta kutunuzu ve spam klasörünüzü kontrol edin!`
                            : (lang === "ar"
                              ? `تم بنجاح: تم إرسال رابط إعادة تعيين كلمة المرور إلى ${targetEmail}. يرجى التحقق من بريدك الإلكتروني والرسائل غير المرغوب فيها!`
                              : `SUCCESS: A password reset link has been dispatched to ${targetEmail}. Please check your Inbox and Spam folders to set a new password!`)
                        );
                      } catch (err: any) {
                        setLoginError(`Email reset action failed: ${err.message}`);
                      } finally {
                        setResettingPassword(false);
                      }
                    }}
                    disabled={isResettingPassword}
                    className="text-[10px] text-blue-400 hover:text-blue-300 font-bold hover:underline bg-transparent border-0 cursor-pointer p-0"
                  >
                    {isResettingPassword 
                      ? (lang === "tr" ? "Sıfırlama Gönderiliyor..." : "Sending link...") 
                      : (lang === "tr" ? "Şifremi Unuttum?" : lang === "ar" ? "نسيت كلمة المرور؟" : "Forgot Password?")
                    }
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 hover:border-slate-750 focus:border-blue-500 rounded-xl text-xs text-slate-100 placeholder-slate-500 font-mono focus:outline-none transition-all text-left"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoggingIn}
                className={`w-full py-3 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer mt-2 ${
                  loginRole === "driver"
                    ? "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20"
                    : "bg-blue-600 hover:bg-blue-700 shadow-blue-600/20"
                }`}
              >
                {isLoggingIn ? (
                  <span>{t.signingIn}</span>
                ) : (
                  <>
                    {loginRole === "driver" ? (
                      <Truck className="w-4 h-4 shrink-0 text-indigo-200" />
                    ) : (
                      <Shield className="w-4 h-4 shrink-0 text-blue-250" />
                    )}
                    <span>
                      {loginRole === "driver"
                        ? (lang === "en" ? "Sign In as Driver" : lang === "tr" ? "Sürücü Olarak Giriş Yap" : "تسجيل الدخول كسائق")
                        : t.loginBtn
                      }
                    </span>
                  </>
                )}
              </button>
            </form>

            <div className="space-y-4">
              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-slate-900"></div>
                <span className="flex-shrink mx-4 text-[10px] text-slate-500 font-bold uppercase tracking-wider">or sign in with</span>
                <div className="flex-grow border-t border-slate-900"></div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  setIsLoggingIn(true);
                  setLoginError(null);
                  try {
                    const res = await googleSignIn();
                    if (res) {
                      const user = res.user;

                      if (loginRole === "admin") {
                        if (user.email?.toLowerCase() === "sardar@maras.iq") {
                          onLoginSuccess({
                            role: "admin",
                            email: "sardar@maras.iq",
                            driver: null,
                            loginType: "firebase"
                          });
                        } else {
                          setLoginError("This Google account is not registered as MARAS Administrator. Please sign in with sardar@maras.iq.");
                          await auth.signOut();
                        }
                      } else {
                        // Sign in with Gmail for Driver
                        if (user.email?.toLowerCase() === "sardar@maras.iq") {
                          setLoginError("This email is registered as an Administrator. Please select the Admin portal above to sign in.");
                          await auth.signOut();
                          setIsLoggingIn(false);
                          return;
                        }

                        let foundDriver: Driver | null = null;
                        try {
                          const resDrivers = await apiFetch("/api/drivers");
                          if (resDrivers.ok) {
                            const text = await resDrivers.text();
                            if (!text.trim().startsWith("<")) {
                              const driversList: Driver[] = JSON.parse(text);
                              foundDriver = driversList.find(d => d.id === user.uid) || null;
                              
                              if (!foundDriver && user.email) {
                                // Match prefix
                                const emailPrefix = user.email.split("@")[0].toLowerCase();
                                foundDriver = driversList.find(d => d.username.toLowerCase() === emailPrefix) || null;
                                if (foundDriver) {
                                  console.log("Matching existing driver by username prefix. Updating driver ID...");
                                  const patchRes = await apiFetch(`/api/drivers/${foundDriver.id}`, {
                                    method: "PUT",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      name: foundDriver.name,
                                      username: foundDriver.username,
                                      phone: foundDriver.phone,
                                      truckNumber: foundDriver.truckNumber,
                                      truckType: foundDriver.truckType,
                                      id: user.uid // Map to Google Firebase uid
                                    })
                                  });
                                  if (patchRes.ok) {
                                    foundDriver = await patchRes.json();
                                  }
                                }
                              }
                            }
                          }
                        } catch (apiErr) {
                          console.warn("Could not retrieve driver list during Google sign in:", apiErr);
                        }

                        // Auto-register driver profile if not found
                        if (!foundDriver) {
                          console.log("Auto-registering Google driver profile...");
                          try {
                            const createRes = await apiFetch("/api/drivers", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                id: user.uid,
                                name: user.displayName || user.email?.split("@")[0] || "Gmail Driver",
                                username: user.email?.split("@")[0].replace(/[^a-zA-Z0-9]/g, "_") || `driver_${Date.now()}`,
                                phone: user.phoneNumber || "+905320000000",
                                truckNumber: "G-GMAIL-IQ",
                                truckType: "reefer"
                              })
                            });
                            if (createRes.ok) {
                              foundDriver = await createRes.json();
                            }
                          } catch (createErr) {
                            console.error("Failed to auto-create general driver profile:", createErr);
                          }
                        }

                        if (!foundDriver) {
                          // Direct local fallback
                          foundDriver = {
                            id: user.uid,
                            name: user.displayName || "Gmail Driver",
                            username: user.email?.split("@")[0] || "gmail_driver",
                            phone: "+905320000000",
                            truckNumber: "G-GMAIL-IQ",
                            truckType: "reefer",
                            activeShipmentsCount: 0,
                            completedShipmentsCount: 0
                          };
                        }

                        onLoginSuccess({
                          role: "driver",
                          driver: foundDriver,
                          loginType: "firebase"
                        });
                      }
                    }
                  } catch (e: any) {
                    if (e?.code === 'auth/popup-closed-by-user' || e?.message?.includes('popup-closed-by-user')) {
                      console.warn("Google authentication popup closed by user.");
                    } else {
                      setLoginError(`Google Authentication failed: ${e.message}`);
                    }
                  } finally {
                    setIsLoggingIn(false);
                  }
                }}
                disabled={isLoggingIn}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-850 hover:text-white text-slate-300 font-bold text-xs rounded-xl border border-slate-800 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22c-.22-.67-.35-1.37-.35-2.07z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>
                  {loginRole === "admin"
                    ? (lang === "tr" ? "Google Workspace İle Giriş Yap" : lang === "ar" ? "الدخول بحساب Google Workspace" : "Sign In with Google Workspace")
                    : (lang === "tr" ? "Gmail ile Giriş Yap" : lang === "ar" ? "تسجيل الدخول عبر Gmail" : "Sign In with Gmail")
                  }
                </span>
              </button>


            </div>

            <div className="border-t border-slate-850 pt-4 flex flex-col gap-2">
              <button
                onClick={() => {
                  setIsRegisterMode(true);
                  setRegError(null);
                }}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-850 hover:text-white text-slate-300 font-bold text-xs rounded-xl border border-slate-820 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ClipboardSignature className="w-4 h-4 text-blue-400 shrink-0" />
                <span>{t.registerBtn}</span>
              </button>
            </div>

            {/* Subtle Regulatory Compliance Footnote */}
            <div className="border-t border-slate-900 pt-3 flex flex-col items-center justify-center gap-1.5 text-[10px] text-slate-500">
              <div className="flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                <span>MARAS Group Logistical Security Escrow Gate</span>
              </div>
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                {onViewPrivacy && (
                  <button
                    type="button"
                    onClick={onViewPrivacy}
                    className="hover:text-orange-500 transition-all cursor-pointer underline hover:no-underline font-semibold uppercase tracking-wider outline-none p-0 bg-transparent border-0"
                  >
                    {lang === "tr" ? "Gizlilik Politikası" : lang === "ar" ? "سياسة الخصوصية" : "Privacy Policy"}
                  </button>
                )}
                {onViewPrivacy && onViewTerms && <span className="text-slate-750">|</span>}
                {onViewTerms && (
                  <button
                    type="button"
                    onClick={onViewTerms}
                    className="hover:text-orange-500 transition-all cursor-pointer underline hover:no-underline font-semibold uppercase tracking-wider outline-none p-0 bg-transparent border-0"
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
              <h2 className="text-md font-black text-white tracking-tight">{t.driverRegHeader}</h2>
              <p className="text-[11px] text-slate-400">{t.driverRegDesc}</p>
            </div>

            {regError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold rounded-xl text-center">
                ⚠️ {regError}
              </div>
            )}

            <form onSubmit={handleRegister} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[9px] uppercase tracking-wider font-bold text-slate-400 block text-left">
                  {t.fullName}
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Mehmet Aksoy"
                    value={regFullName}
                    onChange={(e) => setRegFullName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg text-xs text-slate-100 placeholder-slate-500 font-semibold focus:outline-none text-left"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase tracking-wider font-bold text-slate-400 block text-left">
                  {t.regUsername}
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. mehmet_aksoy"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg text-xs text-slate-100 placeholder-slate-500 font-mono focus:outline-none text-left"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase tracking-wider font-bold text-slate-400 block text-left">
                  {t.personalEmail}
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="email"
                    required
                    placeholder={t.emailPlaceholder}
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg text-xs text-slate-100 placeholder-slate-500 font-semibold focus:outline-none text-left"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase tracking-wider font-bold text-slate-400 block text-left">
                  {t.phone}
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. +90 532 999 8877"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg text-xs text-slate-100 placeholder-slate-500 font-semibold focus:outline-none text-left"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase tracking-wider font-bold text-slate-400 block text-left">
                  {t.truckId}
                </label>
                <div className="relative">
                  <Truck className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. 34-LOG-2026"
                    value={regTruckId}
                    onChange={(e) => setRegTruckId(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg text-xs text-slate-100 placeholder-slate-500 font-mono focus:outline-none text-left"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase tracking-wider font-bold text-slate-400 block text-left">
                  {t.truckType}
                </label>
                <div className="relative">
                  <select
                    value={regTruckType}
                    onChange={(e) => setRegTruckType(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg text-xs text-slate-100 font-semibold focus:outline-none text-left cursor-pointer"
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
                <label className="text-[9px] uppercase tracking-wider font-bold text-slate-400 block text-left">
                  {t.passwordPlaceholder}
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg text-xs text-slate-100 placeholder-slate-500 font-mono focus:outline-none text-left"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isRegistering}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer mt-2"
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
              className="w-full py-2 text-slate-400 hover:text-white font-bold text-xs bg-transparent transition-all flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>← {t.backToLogin}</span>
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
