/**
 * Hotel dashboard — listing status and the approval workflow.
 * ------------------------------------------------------------------
 * This is the screen that explains *why* a change is not visible to customers.
 * The public Stay page reads `publishedSnapshot` (the last admin-approved
 * version), so a hotel editing a published listing is deliberately not public
 * until it is submitted and an admin approves again. The `hasUnpublishedChanges`
 * flag comes from comparing a content hash, not from a guess.
 */
import { useState } from "react";
import { toast } from "react-hot-toast";
import { FiArchive, FiCheckCircle, FiClock, FiRotateCcw, FiSend, FiUploadCloud } from "react-icons/fi";
import { apiErrorMessage, hotelApi, imageSrc, type StatusHistoryEntry } from "../../api/hotel";
import { useHotelDashboard } from "./context";
import { formatDateTimeLabel, statusLabel } from "./helpers";
import {
  Alert,
  Button,
  Card,
  Confirm,
  PageHeader,
  StatusBadge,
} from "./ui";

/* ------------------------------------------------------------------ */
/* Per-status guidance                                                  */
/* ------------------------------------------------------------------ */

const STATUS_EXPLAINER: Record<string, { title: string; body: string }> = {
  draft: {
    title: "Your listing is a draft",
    body: "Only you can see it. Fill in your profile, add at least one room type, then submit it for review.",
  },
  pending_approval: {
    title: "Under review",
    body: "An admin is checking your submission. You can keep editing your draft — if you do, the submission is treated as withdrawn and goes back to draft.",
  },
  published: {
    title: "Your listing is live",
    body: "Customers can find and book your property. Edits you make now stay private until you submit them again and an admin approves the new version.",
  },
  rejected: {
    title: "Your listing was rejected",
    body: "Read the reason below, fix what was asked, and submit again.",
  },
  suspended: {
    title: "Your listing is suspended",
    body: "It is no longer visible to customers. Contact admin support to have it reinstated.",
  },
  archived: {
    title: "Your listing is archived",
    body: "It is hidden from the public site. Restore it to go back to draft and resubmit whenever you are ready.",
  },
};

/* ------------------------------------------------------------------ */

const HotelListing = () => {
  const { hotel, listing, readiness, stats, rooms, refresh } = useHotelDashboard();

  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<
    null | "submit" | "withdraw" | "archive" | "restore"
  >(null);

  if (!hotel || !listing) return null;

  const actions = listing.allowedActions;
  const blockers = readiness?.blockers ?? [];
  const warnings = readiness?.warnings ?? [];
  const explainer = STATUS_EXPLAINER[hotel.listingStatus];
  const activeRooms = rooms.filter((room) => !room.isArchived && room.isActive);

  const run = async (
    action: "submit" | "withdraw" | "archive" | "restore",
    call: () => Promise<{ message?: string; warning?: string | null }>
  ) => {
    setBusy(action);
    try {
      const result = await call();
      await refresh();
      if (result.message) toast.success(result.message);
      if (result.warning) toast(result.warning, { icon: "⚠️" });
    } catch (error) {
      toast.error(apiErrorMessage(error, "That action could not be completed."));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  /* --------------------------- unavailable --------------------------- */

  if (hotel.listingStatus === "suspended" || hotel.listingStatus === "archived") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Listing status"
          action={<StatusBadge status={hotel.listingStatus} />}
        />

        <Card>
          <h2 className="text-lg font-bold text-slate-900">{explainer?.title}</h2>
          <p className="mt-2 text-sm text-slate-600">{explainer?.body}</p>

          {hotel.listingStatus === "suspended" && hotel.statusMeta?.suspendedReason && (
            <div className="mt-4">
              <Alert tone="danger">Reason: {hotel.statusMeta.suspendedReason}</Alert>
            </div>
          )}

          {actions.canRestore && (
            <div className="mt-5">
              <Button
                type="button"
                busy={busy === "restore"}
                onClick={() => setConfirming("restore")}
              >
                <FiRotateCcw size={16} /> Restore listing
              </Button>
            </div>
          )}
        </Card>

        <StatusHistory history={listing.statusHistory} />

        <Confirm
          open={confirming === "restore"}
          title="Restore this listing?"
          message="It comes back as a draft. You will need to submit it again for approval before customers can see it."
          confirmLabel="Restore"
          tone="primary"
          busy={busy === "restore"}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void run("restore", () => hotelApi.restoreListing())}
        />
      </div>
    );
  }

  /* ------------------------------ active ------------------------------ */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Listing status"
        subtitle="Submit your listing for admin approval, and track what is public right now."
        action={<StatusBadge status={hotel.listingStatus} />}
      />

      {/* rejection / withdrawal notices */}
      {hotel.listingStatus === "rejected" && listing.rejectionReason && (
        <Alert tone="danger">
          <strong>Rejected.</strong> {listing.rejectionReason}
        </Alert>
      )}

      {listing.hasUnpublishedChanges && (
        <Alert tone="info">
          You have changes that customers cannot see yet. The public page still shows version{" "}
          <strong>v{listing.publishedVersion || 0}</strong> — the last version an admin approved.
        </Alert>
      )}

      {/* status panel + actions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={explainer?.title}>
          <p className="text-sm text-slate-600">{explainer?.body}</p>

          <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Current status
              </dt>
              <dd className="mt-1">
                <StatusBadge status={hotel.listingStatus} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Published version
              </dt>
              <dd className="mt-1 text-sm font-bold text-slate-800">
                {listing.publishedVersion ? `v${listing.publishedVersion}` : "Not published"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Last published
              </dt>
              <dd className="mt-1 text-sm text-slate-600">
                {formatDateTimeLabel(listing.publishedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Submitted
              </dt>
              <dd className="mt-1 text-sm text-slate-600">
                {formatDateTimeLabel(listing.statusMeta?.submittedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Active rooms
              </dt>
              <dd className="mt-1 text-sm text-slate-600">{activeRooms.length}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Total inventory
              </dt>
              <dd className="mt-1 text-sm text-slate-600">{stats?.totalInventory ?? 0}</dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-wrap gap-3">
            {actions.canSubmit && (
              <Button
                type="button"
                busy={busy === "submit"}
                disabled={blockers.length > 0}
                onClick={() => setConfirming("submit")}
              >
                <FiSend size={16} /> Submit for approval
              </Button>
            )}

            {actions.canWithdraw && (
              <Button
                type="button"
                variant="secondary"
                busy={busy === "withdraw"}
                onClick={() => setConfirming("withdraw")}
              >
                <FiRotateCcw size={16} />
                {hotel.listingStatus === "published" ? "Withdraw from site" : "Withdraw submission"}
              </Button>
            )}

            {actions.canArchive && (
              <Button
                type="button"
                variant="ghost"
                busy={busy === "archive"}
                onClick={() => setConfirming("archive")}
              >
                <FiArchive size={16} /> Archive listing
              </Button>
            )}
          </div>

          {actions.canSubmit && blockers.length > 0 && (
            <div className="mt-4">
              <Alert tone="warning">
                Resolve the {blockers.length} blocker(s) below before submitting.
              </Alert>
            </div>
          )}
        </Card>

        {/* snapshot preview */}
        <Card title="What customers see" description="The last approved version of your listing.">
          {hotel.coverImage ? (
            <img
              src={imageSrc(hotel.coverImage)}
              alt="Listing cover"
              className="h-40 w-full rounded-xl object-cover"
            />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs font-semibold text-slate-400">
              No cover image
            </div>
          )}

          <p className="mt-3 font-bold text-slate-800">{hotel.hotelName || "Unnamed property"}</p>
          <p className="text-sm text-slate-500">
            {hotel.type}
            {hotel.city ? ` · ${hotel.city}` : ""} · {hotel.starRating} star
            {hotel.starRating === 1 ? "" : "s"}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {listing.publishedVersion
              ? `Published v${listing.publishedVersion} on ${formatDateTimeLabel(listing.publishedAt)}.`
              : "Not published yet — nothing is visible on the public site."}
          </p>
        </Card>
      </div>

      {/* readiness */}
      {actions.canSubmit && (
        <Card
          title="Before you submit"
          description="Blockers must be fixed. Warnings are recommendations."
          action={
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                blockers.length === 0
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-rose-100 text-rose-800"
              }`}
            >
              {blockers.length === 0 ? "Ready" : `${blockers.length} blocker(s)`}
            </span>
          }
        >
          {blockers.length === 0 && warnings.length === 0 && (
            <Alert tone="success">
              Everything checks out. Submit whenever you are ready.
            </Alert>
          )}

          {blockers.length > 0 && (
            <>
              <p className="mb-2 text-sm font-semibold text-rose-700">Blockers</p>
              <ul className="space-y-2">
                {blockers.map((issue, index) => (
                  <li
                    key={`blocker-${index}`}
                    className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-inset ring-rose-200"
                  >
                    {issue.message}
                  </li>
                ))}
              </ul>
            </>
          )}

          {warnings.length > 0 && (
            <>
              <p className="mb-2 mt-4 text-sm font-semibold text-amber-700">
                Recommendations
              </p>
              <ul className="space-y-2">
                {warnings.map((issue, index) => (
                  <li
                    key={`warning-${index}`}
                    className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-200"
                  >
                    {issue.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      <StatusHistory history={listing.statusHistory} />

      {/* ------------------------------ confirms ------------------------------ */}
      <Confirm
        open={confirming === "submit"}
        title="Submit your listing for approval?"
        message="An admin will review it. Until it is approved, customers keep seeing your last approved version. You can keep editing your draft in the meantime."
        confirmLabel="Submit for approval"
        tone="primary"
        busy={busy === "submit"}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void run("submit", () => hotelApi.submitListing())}
      />

      <Confirm
        open={confirming === "withdraw"}
        title={hotel.listingStatus === "published" ? "Withdraw from the public site?" : "Withdraw this submission?"}
        message={
          hotel.listingStatus === "published"
            ? "Your listing will no longer be visible to customers and becomes a draft again. Submit it again whenever you want to go live."
            : "Your submission is cancelled and the listing goes back to draft."
        }
        confirmLabel="Withdraw"
        busy={busy === "withdraw"}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void run("withdraw", () => hotelApi.withdrawListing())}
      />

      <Confirm
        open={confirming === "archive"}
        title="Archive this listing?"
        message="It is hidden from the public site and you stop receiving bookings. You can restore it later as a draft."
        confirmLabel="Archive"
        busy={busy === "archive"}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void run("archive", () => hotelApi.archiveListing())}
      />
    </div>
  );
};

export default HotelListing;

/* ------------------------------------------------------------------ */
/* Status history                                                       */
/* ------------------------------------------------------------------ */

const StatusHistory = ({ history }: { history: StatusHistoryEntry[] }) => (
  <Card title="Status history" description="Every lifecycle change on this listing.">
    {history.length === 0 ? (
      <p className="text-sm text-slate-500">No changes recorded yet.</p>
    ) : (
      <ol className="space-y-3">
        {history.map((entry) => (
          <li key={entry._id} className="flex gap-4">
            <span className="mt-1 shrink-0 text-slate-300">
              {entry.to === "published" ? (
                <FiUploadCloud size={18} className="text-emerald-500" />
              ) : entry.to === "pending_approval" ? (
                <FiClock size={18} className="text-amber-500" />
              ) : entry.to === "rejected" ? (
                <FiArchive size={18} className="text-rose-500" />
              ) : (
                <FiCheckCircle size={18} className="text-slate-400" />
              )}
            </span>

            <div className="min-w-0 flex-1 border-b border-slate-50 pb-3 last:border-0">
              <p className="text-sm font-semibold text-slate-800">
                {entry.from ? `${statusLabel(entry.from)} → ` : ""}
                {statusLabel(entry.to)}
              </p>
              {entry.reason && <p className="mt-0.5 text-sm text-slate-600">{entry.reason}</p>}
              <p className="mt-0.5 text-xs text-slate-400">{formatDateTimeLabel(entry.at)}</p>
            </div>
          </li>
        ))}
      </ol>
    )}
  </Card>
);
