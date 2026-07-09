import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Full className for the <input>. Include extra end-padding to leave room for the toggle button. */
  inputClassName: string;
  /** className for the wrapping <div>. Defaults to "relative". */
  wrapperClassName?: string;
  /** Leading icon element, e.g. <Lock className="absolute start-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />. */
  leadingIcon?: React.ReactNode;
  /** className for the toggle <button>, positioned/sized to match the form it's used in. */
  toggleClassName?: string;
  /** aria-label/title shown when the password is currently hidden. */
  showLabel: string;
  /** aria-label/title shown when the password is currently visible. */
  hideLabel: string;
}

export default function PasswordInput({
  inputClassName,
  wrapperClassName = "relative",
  leadingIcon,
  toggleClassName = "absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer bg-transparent border-0 p-0",
  showLabel,
  hideLabel,
  ...inputProps
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={wrapperClassName}>
      {leadingIcon}
      <input {...inputProps} type={visible ? "text" : "password"} className={inputClassName} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        title={visible ? hideLabel : showLabel}
        className={toggleClassName}
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}
