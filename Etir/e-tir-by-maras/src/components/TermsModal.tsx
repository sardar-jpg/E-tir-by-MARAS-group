import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Scale, FileSymlink, ScrollText, CheckCircle2, ShieldAlert, BookOpen, AlertCircle, HelpCircle, Landmark, Globe, Mail } from "lucide-react";

interface TermsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: "tr" | "ar" | "en";
}

export default function TermsModal({ isOpen, onClose, lang = "en" }: TermsModalProps) {
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
            id="terms-conditions-modal-container"
          >
            {/* Header */}
            <div className="bg-slate-950 border-b border-slate-800 p-4 shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-600/10 text-orange-500 rounded-xl border border-orange-500/20">
                  <Scale className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-white tracking-widest uppercase">
                    {lang === "tr" ? "KULLANIM KOŞULLARI" : lang === "ar" ? "الشروط والأحكام" : "TERMS & CONDITIONS"}
                  </h2>
                  <p className="text-[10px] text-slate-400 font-medium font-mono uppercase">e-TIR BY MARAS GROUP LEGAL PORTAL</p>
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
              {/* Introduction Card */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-3.5 shadow-inner">
                <ScrollText className="w-6 h-6 text-orange-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-1">
                    {lang === "tr" ? "Kullanım Şartları ve Koşulları" : lang === "ar" ? "البنود والشروط القانونية" : "User Agreement & Terms of Service"}
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Welcome to the <strong className="text-slate-100">e-TIR by MARAS</strong> digital system. By accessing or using this logistical gateway, customs declaration ledger, or tracking client portal, you agree to comply with and be bound by the following Terms & Conditions.
                  </p>
                  <p className="text-[10px] text-orange-500 font-mono font-bold mt-2 uppercase tracking-wide font-medium">
                    {lang === "tr" ? "Yürürlük Tarihi:" : lang === "ar" ? "تاريخ النفاذ:" : "Effective Date:"} June 2026
                  </p>
                </div>
              </div>

              {/* SECTION 1: Eligibility and Accounts */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <CheckCircle2 className="w-4 h-4 text-orange-500" />
                  <h4 className="text-xs font-black text-slate-200 uppercase tracking-widest">
                    1. Eligibility & System Access
                  </h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Access to the e-TIR terminal, customs databases, cost declaration ledger, and driver consignment feeds is granted exclusively to:
                </p>
                <ul className="space-y-2 text-[11px] text-slate-300 pl-4 list-disc">
                  <li><strong>Authorized Personnel & Dispatchers:</strong> Internal employees authenticated via verified corporate directories or synchronized credential vaults.</li>
                  <li><strong>Registered Drivers & Carriers:</strong> Drivers who have successfully completed the onboarding phase, verified their licenses, and hold validated vehicles.</li>
                  <li><strong>Affiliated Clients / Customers:</strong> Permitted external stakeholders tracking consignment and cargo manifests via direct secure public keys.</li>
                </ul>
              </div>

              {/* SECTION 2: Acceptable Use & Carrier Accountability */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <BookOpen className="w-4 h-4 text-orange-500" />
                  <h4 className="text-xs font-black text-slate-200 uppercase tracking-widest">
                    2. Acceptable Use & Operational Standards
                  </h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  As an authenticated user, you agree that you will not:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-slate-305">
                  <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-800 space-y-1">
                    <span className="font-bold text-slate-200 block">Manifest Accuracy</span>
                    <span className="text-slate-400 text-[10.5px]">Submit inaccurate, fraudulent, or missing cargo manifests, receipts, cost statements, customs clearances, or driver licensing credentials.</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-800 space-y-1">
                    <span className="font-bold text-slate-200 block">GPS Telemetry Spoofing</span>
                    <span className="text-slate-400 text-[10.5px]">Intentionally alter, spoof, or simulate GPS coordinate positions during tracked shipment operations.</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-800 space-y-1">
                    <span className="font-bold text-slate-200 block">Unauthorized Access</span>
                    <span className="text-slate-400 text-[10.5px]">Access restricted modules (e.g., administrator accounting panels, systemic logging cores) without clear privileges.</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-800 space-y-1">
                    <span className="font-bold text-slate-200 block">Transit Regulations</span>
                    <span className="text-slate-400 text-[10.5px]">Violate national customs statutes or TIR international conventions applicable inside Turkey, Iraq, and neighboring jurisdictions.</span>
                  </div>
                </div>
              </div>

              {/* GRID SECTIONS: Limitation of Liability & Document Validity */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-slate-200">
                    <ShieldAlert className="w-4 h-4 text-orange-500" />
                    <h5 className="text-[11px] font-black uppercase tracking-wider">Limitation of Liability</h5>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    MARAS Group acts as an e-TIR portal facilitator and carrier coordinator. We do not assume liability for border custom processing interruptions, delayed customs clearing cycles, weather transit obstacles, or hardware failure of carrier telemetry modules.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-slate-200">
                    <FileSymlink className="w-4 h-4 text-orange-500" />
                    <h5 className="text-[11px] font-black uppercase tracking-wider">Document Integrity</h5>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Carriers are solely responsible for ensuring uploaded bills of lading (CMR), customs entries, clearance declarations, and expense receipts are legitimate and compliant with financial audit standards in their respective operating countries.
                  </p>
                </div>
              </div>

              {/* SECTION: Credential Audits & Termination */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <AlertCircle className="w-4 h-4 text-orange-500" />
                  <h4 className="text-xs font-black text-slate-200 uppercase tracking-widest">
                    3. Termination & Credential Suspension
                  </h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  MARAS reserves the right, in its sole discretion and without prior formal notice, to suspend, terminate, or restrict account permissions of any user found violating carrier guidelines, attempting vector injection against tracking maps, or falsely entering financial cost statements in the Accounts ledger.
                </p>
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
                    <span>Email: <strong>info@maras.iq</strong></span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 italic mt-1 bg-slate-905/20 p-2 rounded">
                  We reserve the right to revise or renew this carrier agreement from time to time as customs legislation changes. Continued use of the tools implies formal compliance with active protocols.
                </p>
              </div>
            </div>

            {/* Footer / Agree */}
            <div className="bg-slate-950 border-t border-slate-800 p-4 shrink-0 flex items-center justify-between">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black hidden sm:inline font-mono">
                e-TIR TERMINAL AGREEMENT
              </span>
              <button
                type="button"
                onClick={onClose}
                className="w-full sm:w-auto px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white hover:text-white rounded-xl text-xs font-black transition-all border-0 outline-none cursor-pointer text-center"
              >
                {lang === "tr" ? "Okudum ve Kabul Ediyorum" : lang === "ar" ? "أوافق وأغلق" : "Agree & Acknowledge"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
