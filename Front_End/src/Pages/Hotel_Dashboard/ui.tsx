/**
 * Shared presentational primitives for the hotel dashboard.
 * ------------------------------------------------------------------
 * Kept in one place so the seven dashboard screens stay consistent without
 * pulling in a component library. Tailwind only, matching the vendor dashboard.
 * This module exports components only — plain helpers live in `helpers.ts`.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { ListingStatus } from "../../api/hotel";
import { STATUS_LABELS } from "./helpers";

/* ------------------------------------------------------------------ */
/* Status badge                                                         */
/* ------------------------------------------------------------------ */

const STATUS_STYLES: Record<ListingStatus, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  pending_approval: "bg-amber-100 text-amber-800 ring-amber-200",
  published: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  rejected: "bg-rose-100 text-rose-800 ring-rose-200",
  suspended: "bg-orange-100 text-orange-800 ring-orange-200",
  archived: "bg-zinc-200 text-zinc-700 ring-zinc-300",
};

export const StatusBadge = ({ status }: { status: ListingStatus }) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
      STATUS_STYLES[status] ?? STATUS_STYLES.draft
    }`}
  >
    {STATUS_LABELS[status] ?? status}
  </span>
);

/* ------------------------------------------------------------------ */
/* Layout                                                               */
/* ------------------------------------------------------------------ */

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export const PageHeader = ({ title, subtitle, action }: PageHeaderProps) => (
  <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">{title}</h1>
      {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
    </div>
    {action}
  </div>
);

interface CardProps {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export const Card = ({ title, description, action, children, className = "" }: CardProps) => (
  <section
    className={`rounded-2xl border border-slate-100 bg-white p-5 shadow-card md:p-6 ${className}`}
  >
    {(title || action) && (
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          {title && <h2 className="text-base font-bold text-slate-900">{title}</h2>}
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
    )}
    {children}
  </section>
);

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "teal" | "amber" | "rose" | "slate";
}

const STAT_TONES = {
  teal: "bg-teal-50 text-teal-700",
  amber: "bg-amber-50 text-amber-700",
  rose: "bg-rose-50 text-rose-700",
  slate: "bg-slate-100 text-slate-600",
} as const;

export const StatCard = ({ label, value, hint, tone = "teal" }: StatCardProps) => (
  <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
    <span
      className={`inline-flex rounded-lg px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${STAT_TONES[tone]}`}
    >
      {label}
    </span>
    <p className="mt-3 text-2xl font-bold text-slate-900">{value}</p>
    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
  </div>
);

/* ------------------------------------------------------------------ */
/* Form fields                                                          */
/* ------------------------------------------------------------------ */

const fieldBase =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

interface FieldProps {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
}

export const Field = ({ label, children, hint, error, required, className = "" }: FieldProps) => (
  <label className={`block ${className}`}>
    <span className="mb-1.5 block text-sm font-semibold text-slate-700">
      {label}
      {required && <span className="ml-0.5 text-rose-500">*</span>}
    </span>
    {children}
    {error ? (
      <span className="mt-1 block text-xs font-medium text-rose-600">{error}</span>
    ) : (
      hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>
    )}
  </label>
);

const inputClass = (invalid = false) =>
  `${fieldBase} ${invalid ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : ""}`;

export const Input = ({
  invalid,
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) => (
  <input {...props} className={`${inputClass(invalid)} ${className}`} />
);

export const Textarea = ({
  invalid,
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) => (
  <textarea {...props} className={`${inputClass(invalid)} min-h-[96px] ${className}`} />
);

export const Select = ({
  invalid,
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) => (
  <select {...props} className={`${inputClass(invalid)} ${className}`}>
    {children}
  </select>
);

/* ------------------------------------------------------------------ */
/* Buttons                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-teal-600 text-white hover:bg-teal-700 disabled:bg-teal-300",
  secondary:
    "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  busy?: boolean;
}

export const Button = ({
  variant = "primary",
  busy = false,
  disabled,
  className = "",
  children,
  ...props
}: ButtonProps) => (
  <button
    {...props}
    disabled={disabled || busy}
    className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${className}`}
  >
    {busy && (
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
    )}
    {children}
  </button>
);

/* ------------------------------------------------------------------ */
/* Feedback                                                             */
/* ------------------------------------------------------------------ */

export const Spinner = ({ label = "Loading…" }: { label?: string }) => (
  <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
    <span className="h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
    {label}
  </div>
);

export const Alert = ({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  children: ReactNode;
}) => {
  const tones = {
    info: "bg-sky-50 text-sky-800 ring-sky-200",
    success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    warning: "bg-amber-50 text-amber-800 ring-amber-200",
    danger: "bg-rose-50 text-rose-800 ring-rose-200",
  } as const;

  return (
    <div className={`rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </div>
  );
};

interface EmptyStateProps {
  title: string;
  message: string;
  action?: ReactNode;
}

export const EmptyState = ({ title, message, action }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-teal-200 bg-teal-50/50 px-6 py-14 text-center">
    <h3 className="text-lg font-bold text-slate-900">{title}</h3>
    <p className="mt-2 max-w-md text-sm text-slate-500">{message}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>
);

/* ------------------------------------------------------------------ */
/* Amenity picker                                                       */
/* ------------------------------------------------------------------ */

interface CatalogItem {
  key: string;
  label: string;
  category: string;
}

interface AmenityPickerProps {
  catalog: CatalogItem[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Group the chips under their category headings. */
  grouped?: boolean;
  disabled?: boolean;
}

const humanise = (category: string) =>
  category.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

export const AmenityPicker = ({
  catalog,
  value,
  onChange,
  grouped = true,
  disabled = false,
}: AmenityPickerProps) => {
  const selected = new Set(value);

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next]);
  };

  const byCategory = catalog.reduce<Record<string, CatalogItem[]>>((acc, amenity) => {
    (acc[amenity.category] ||= []).push(amenity);
    return acc;
  }, {});

  const sections: Array<[string, CatalogItem[]]> = grouped
    ? (Object.entries(byCategory) as Array<[string, CatalogItem[]]>)
    : [["", catalog]];

  return (
    <div className="space-y-4">
      {sections.map(([category, items]) => (
        <div key={category || "all"}>
          {grouped && (
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              {humanise(category)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {items.map((amenity) => {
              const active = selected.has(amenity.key);
              return (
                <button
                  key={amenity.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(amenity.key)}
                  aria-pressed={active}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    active
                      ? "border-teal-600 bg-teal-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
                  }`}
                >
                  {amenity.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {catalog.length === 0 && (
        <p className="text-sm text-slate-500">No amenities available to load.</p>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Modal                                                                */
/* ------------------------------------------------------------------ */

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export const Modal = ({ open, title, onClose, children, footer, wide = false }: ModalProps) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`w-full ${wide ? "max-w-4xl" : "max-w-2xl"} rounded-2xl bg-white shadow-card-lg`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Confirm dialog                                                       */
/* ------------------------------------------------------------------ */

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const Confirm = ({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  busy = false,
  requireText,
  onConfirm,
  onCancel,
}: ConfirmProps) => {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  if (!open) return null;

  const blocked = Boolean(requireText) && typed.trim().toUpperCase() !== requireText?.toUpperCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-card-lg">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{message}</p>

        {requireText && (
          <div className="mt-4">
            <Field label={`Type ${requireText} to continue`}>
              <Input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={requireText}
                autoFocus
              />
            </Field>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} busy={busy} disabled={blocked} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
