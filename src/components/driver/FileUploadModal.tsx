import { X, Camera } from 'lucide-react';
import type { DocumentCategory } from '../../types';

interface FileUploadModalProps {
  fileName: string;
  onFileNameChange: (name: string) => void;
  category: DocumentCategory;
  onCategoryChange: (category: DocumentCategory) => void;
  onFileSelected: (file: File, dataUrl: string, detectedCategory: DocumentCategory | null) => void;
  onClose: () => void;
  onSubmit: () => void;
  isUploading: boolean;
}

function categoryForFile(file: File): DocumentCategory | null {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/")) return "photo";
  if (name.includes("invoice")) return "invoice";
  if (name.includes("packing")) return "packing_list";
  if (name.includes("customs")) return "customs";
  if (name.includes("delivery") || name.includes("pod")) return "delivery_proof";
  return null;
}

export default function FileUploadModal({
  fileName,
  onFileNameChange,
  category,
  onCategoryChange,
  onFileSelected,
  onClose,
  onSubmit,
  isUploading
}: FileUploadModalProps) {
  return (
    <div className="absolute inset-0 bg-slate-950/90 z-50 flex items-center justify-center p-5 select-none animate-fade-in">
      <div className="bg-slate-900 p-5.5 border border-slate-800/80 rounded-3xl w-full max-w-[320px] space-y-4 shadow-[0_15px_45px_rgba(0,0,0,0.6)] text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <div>
            <h5 className="font-extrabold text-[#f97316] uppercase tracking-wider font-mono">Upload Document</h5>
            <p className="text-[9px] text-slate-500 mt-0.5">Delivery, customs, or other shipment paperwork you need to send to Admin</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors cursor-pointer border-0 bg-transparent p-1"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3.5">
          <div className="space-y-1">
            <label className="text-[9px] font-black text-slate-500 block uppercase tracking-wider font-mono">Upload document photo or PDF</label>
            <input
              type="file"
              accept="image/*,application/pdf,.doc,.docx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const detectedCategory = categoryForFile(file);
                const reader = new FileReader();
                reader.onload = (evt) => {
                  const b64 = evt.target?.result as string;
                  onFileSelected(file, b64, detectedCategory);
                };
                reader.readAsDataURL(file);
              }}
              className="w-full p-2 bg-slate-950 border border-slate-800 text-slate-100 rounded-xl text-xs font-mono file:bg-slate-900 file:border-0 file:text-[9px] file:text-slate-300 file:px-2 file:py-1 file:rounded-md file:mr-2 file:cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[9px] font-black text-slate-500 block uppercase tracking-wider font-mono">File Name</label>
            <input
              type="text"
              placeholder="e.g. DELIVERY_PHOTO_BORDER_GATE_A.jpg"
              value={fileName}
              onChange={(e) => onFileNameChange(e.target.value)}
              className="w-full p-2.5 bg-slate-950 border border-slate-800 text-slate-200 rounded-xl font-mono text-xs focus:border-[#f97316] outline-none transition-all"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[9px] font-black text-slate-500 block uppercase tracking-wider font-mono">Document Category</label>
            <select
              value={category}
              onChange={(e) => onCategoryChange(e.target.value as DocumentCategory)}
              className="w-full p-2.5 bg-slate-950 border border-slate-800 text-slate-200 rounded-xl text-xs font-bold outline-none cursor-pointer"
            >
              <option value="invoice" className="bg-slate-950 text-white font-bold">Invoice Receipt</option>
              <option value="packing_list" className="bg-slate-950 text-white font-bold">Packing Sheet</option>
              <option value="customs" className="bg-slate-950 text-white font-bold">Customs Clearance Receipt</option>
              <option value="delivery_proof" className="bg-slate-950 text-white font-bold">Delivery Voucher (POD)</option>
              <option value="photo" className="bg-slate-950 text-white font-bold">Cargo Live Photo</option>
              <option value="other" className="bg-slate-950 text-white font-bold">Other PDF / Doc File</option>
            </select>
          </div>

          <button
            onClick={onSubmit}
            disabled={!fileName.trim() || isUploading}
            className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:opacity-40 text-white font-extrabold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-95 border-0 shadow-[0_4px_15px_rgba(249,115,22,0.3)] mt-2"
          >
            {isUploading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <Camera className="w-4 h-4 shrink-0" />
            )}
            <span>{isUploading ? "Uploading document..." : "Attach Document"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
