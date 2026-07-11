import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ShieldAlert, BadgeCheck, FileText, CheckCircle2, MapPin, HardDrive, Share2, Shield, Eye, HelpCircle, Activity, Landmark, ExternalLink, Mail, Globe } from "lucide-react";

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: "tr" | "ar" | "en";
}

export default function PrivacyPolicyModal({ isOpen, onClose, lang = "en" }: PrivacyPolicyModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md">
          {/* Backdrop invisible close area */}
          <div className="absolute inset-0 cursor-pointer" onClick={onClose} />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", duration: 0.45 }}
            className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh] text-slate-100"
            id="privacy-policy-modal-container"
          >
            {/* Header */}
            <div className="bg-slate-950 border-b border-slate-800 p-4 shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-600/10 text-orange-500 rounded-xl border border-orange-500/20">
                  <Shield className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-white tracking-widest uppercase">
                    {lang === "tr" ? "GİZLİLİK POLİTİKASI" : lang === "ar" ? "سياسة الخصوصية" : "PRIVACY POLICY"}
                  </h2>
                  <p className="text-[10px] text-slate-400 font-medium">etir BY MARAS GROUP SECURITY PORTAL</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all border-0 outline-none cursor-pointer"
                aria-label="Close Modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Document Content */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
              {/* Core Hero Banner */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-3.5 shadow-inner">
                <FileText className="w-6 h-6 text-orange-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-1">
                    {lang === "tr" ? "Yasal Bildirim" : lang === "ar" ? "إشعار قانوني" : "Legal Notice & Enforcement"}
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Welcome to <strong className="text-slate-100">etir by MARAS</strong>. MARAS Logistics & Supply Chain respects your privacy and is committed to protecting your personal information. This policy governs all core digital customs escrows, active telemetry, and manifest declarations.
                  </p>
                  <p className="text-[10px] text-orange-500 font-mono font-bold mt-2 uppercase tracking-wide">
                    {lang === "tr" ? "Yürürlük Tarihi:" : lang === "ar" ? "تاريخ النفاذ:" : "Effective Date:"} June 2026
                  </p>
                </div>
              </div>

              {/* SECTION: Information We Collect */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <BadgeCheck className="w-4 h-4 text-orange-500" />
                  <h4 className="text-xs font-black text-slate-200 uppercase tracking-widest">
                    1. Information We Collect
                  </h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  The application may collect and securely store the following transactional, operational, and core identifier fields:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {[
                    "Full name / Company identity details",
                    "Phone number & Communication records",
                    "Email address credential logs",
                    "Driver licensing information",
                    "Vehicle & truck registry status",
                    "Shipment manifests & CMR records",
                    "GPS location data during active shipments",
                    "Operational photos & customs documents",
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-1.5 bg-slate-950/40 rounded-lg border border-slate-800/50">
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                      <span className="text-slate-300 text-[11px] font-medium">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* SECTION: How We Use Your Information */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <Activity className="w-4 h-4 text-orange-500" />
                  <h4 className="text-xs font-black text-slate-200 uppercase tracking-widest">
                    2. How We Use Your Information
                  </h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  We leverage collected telemetry, manifests, and system configurations exclusively to:
                </p>
                <ul className="space-y-2 text-[11px] text-slate-300">
                  <li className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span><strong>Manage Logistical Operations:</strong> Enable customs border clearance flow and road transit routing with maximum efficiency.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span><strong>Real-Time Tracking:</strong> Keep active delivery runs fully transparent to corporate dispatch divisions and assigned administrators.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span><strong>Secure Archival Ledger:</strong> Retain compliance documents, transit files, invoices, and customs clearing receipts for record keeping.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span><strong>Security & System Integrity:</strong> Detect fraudulent shipments, secure system authentication protocols, and comply with sovereign border regulations.</span>
                  </li>
                </ul>
              </div>

              {/* GRID SECTIONS: Location Data & Document Storage */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-slate-200">
                    <MapPin className="w-4 h-4 text-orange-500" />
                    <h5 className="text-[11px] font-black uppercase tracking-wider">Location Data</h5>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    The application may access and collect location information only while shipment tracking is active. Location data is used exclusively for transportation monitoring, shipment visibility, and operational purposes.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-slate-200">
                    <HardDrive className="w-4 h-4 text-orange-500" />
                    <h5 className="text-[11px] font-black uppercase tracking-wider">Document Storage</h5>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Documents uploaded through the application, including CMRs, customs documents, delivery confirmations, and shipment photos, may be securely stored on our systems for logistics and record-keeping purposes.
                  </p>
                </div>
              </div>

              {/* SECTION: Information Sharing & Data Security */}
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-gradient-to-r from-slate-950 to-orange-950/10 border border-slate-800 space-y-3">
                  <div className="flex items-center gap-2">
                    <Share2 className="w-4 h-4 text-orange-500" />
                    <h5 className="text-[11px] font-black uppercase tracking-widest text-white">Information Sharing Protocol</h5>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    MARAS does not sell, rent, or trade user information. Information may be shared only with: Authorized MARAS personnel, assigned drivers, customers receiving shipment updates, or government authorities when required by law.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-slate-200">
                    <ShieldAlert className="w-4 h-4 text-emerald-500 animate-pulse" />
                    <h5 className="text-[11px] font-black uppercase tracking-widest">3. Data Security & Retention</h5>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    We implement appropriate technical and organizational measures to protect personal information from unauthorized access, disclosure, alteration, or destruction. Information is retained only as long as necessary for operational, legal, accounting, and security purposes.
                  </p>
                </div>
              </div>

              {/* USER RIGHTS & THIRD-PARTY */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <HelpCircle className="w-4 h-4 text-orange-500" />
                  <h4 className="text-xs font-black text-slate-200 uppercase tracking-widest">
                    4. User Rights & Third Parties
                  </h4>
                </div>
                <div className="space-y-2 text-[11px] text-slate-400 leading-relaxed">
                  <p>
                    <strong>User Rights:</strong> Users may request access to, correction of, or deletion of their personal information by contacting MARAS cargo centers.
                  </p>
                  <p>
                    <strong>Third-Party Services:</strong> The application may use third-party services such as cloud hosting, mapping services, authentication services, and notification services to support application functionality.
                  </p>
                  <p>
                    <strong>Children’s Privacy:</strong> This application is intended for business and logistics operations and is not directed toward individuals under the age of 18.
                  </p>
                </div>
              </div>

              {/* CONTACT COMPLIANCE BLOCK */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-850 space-y-3 text-xs">
                <div className="flex items-center gap-2 text-white font-bold uppercase tracking-wider">
                  <Landmark className="w-4 h-4 text-orange-500" />
                  <span>MARAS Logistics & Supply Chain HQ</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-300">
                  <div className="flex items-center gap-2 bg-slate-900/40 p-1.5 rounded border border-slate-800">
                    <Globe className="w-3.5 h-3.5 text-slate-500" />
                    <span>Website: <strong>www.maras.iq</strong></span>
                  </div>
                  <div className="flex items-center gap-2 bg-slate-900/40 p-1.5 rounded border border-slate-800">
                    <Mail className="w-3.5 h-3.5 text-slate-500" />
                    <span>Email: <strong>support@etir.app</strong></span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 italic mt-1 bg-slate-900/20 p-2 rounded">
                  MARAS may update this Privacy Policy from time to time. Continued use of the application after changes are published constitutes acceptance of the updated policy.
                </p>
              </div>
            </div>

            {/* Footer / Agree */}
            <div className="bg-slate-950 border-t border-slate-800 p-4 shrink-0 flex items-center justify-between">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black hidden sm:inline">
                etir • MARAS LOGISTICS
              </span>
              <button
                type="button"
                onClick={onClose}
                className="w-full sm:w-auto px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white hover:text-white rounded-xl text-xs font-black transition-all border-0 outline-none cursor-pointer text-center"
              >
                {lang === "tr" ? "Anladım ve Kapat" : lang === "ar" ? "فهمت وإغلاق" : "Acknowledge & Close"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
