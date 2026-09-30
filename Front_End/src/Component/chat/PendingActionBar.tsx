/**
 * Confirmation bar for a backend action that changes data.
 * ------------------------------------------------------------------
 * Cancelling a booking and requesting a refund both come back as a
 * `PendingAction` carrying a signed, expiring token. The user has to accept it
 * before anything is written. This is the existing flow — the wording, the two
 * buttons and the `pending.label` from the backend are all unchanged; only the
 * styling is new.
 */
import { FaExclamationTriangle } from "react-icons/fa";
import type { PendingAction } from "../../api";

interface PendingActionBarProps {
  pending: PendingAction;
  isLoading: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}

const PendingActionBar = ({ pending, isLoading, onConfirm, onDecline }: PendingActionBarProps) => (
  <div
    className="border-t border-amber-200 bg-amber-50 px-3 py-2.5 animate-fade-in"
    role="group"
    aria-label="Confirmation needed"
  >
    <p className="mb-2 flex items-start gap-1.5 text-[12px] font-semibold leading-snug text-amber-900">
      <FaExclamationTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      This needs your confirmation before I can continue.
    </p>
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onConfirm}
        disabled={isLoading}
        className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      >
        {pending.label}
      </button>
      <button
        type="button"
        onClick={onDecline}
        disabled={isLoading}
        className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      >
        No, thanks
      </button>
    </div>
  </div>
);

export default PendingActionBar;
