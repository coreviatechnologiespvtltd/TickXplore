/**
 * Pure helpers for the hotel dashboard screens.
 * ------------------------------------------------------------------
 * Deliberately separate from `ui.tsx` so that module only exports React
 * components — mixing the two trips the `react-refresh/only-export-components`
 * rule that the rest of the dashboard folders in this project stay clean on.
 */
import { toDateKey, type ListingStatus } from "../../api/hotel";
import { formatMoney } from "../../utils/format";

/* ------------------------------------------------------------------ */
/* Listing status                                                       */
/* ------------------------------------------------------------------ */

export const STATUS_LABELS: Record<ListingStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending review",
  published: "Published",
  rejected: "Rejected",
  suspended: "Suspended",
  archived: "Archived",
};

export const statusLabel = (status: ListingStatus) => STATUS_LABELS[status] ?? status;

/* ------------------------------------------------------------------ */
/* Formatting                                                           */
/* ------------------------------------------------------------------ */

export const money = (value?: number | null) => formatMoney(value ?? 0);

export const todayKey = () => toDateKey(new Date());

/**
 * The dashboard addresses availability windows as `?from=&to=`, and the backend
 * treats `to` as the checkout date (exclusive of the final night). Nights shown
 * are therefore `from .. to-1`.
 */
export const nightsBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  for (let time = start; time < end; time += 86400000) {
    out.push(toDateKey(new Date(time)));
  }
  return out;
};

export const formatDateLabel = (key?: string | null): string => {
  if (!key) return "—";
  const date = new Date(`${key.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

export const formatDateTimeLabel = (value?: string | null): string => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
