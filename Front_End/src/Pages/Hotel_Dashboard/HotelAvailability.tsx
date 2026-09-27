/**
 * Hotel dashboard — availability calendar and date blocks.
 * ------------------------------------------------------------------
 * Two things live here:
 *   1. The hotel-wide calendar (`GET /availability/calendar`) — one row per
 *      night with free/total rooms, sold-out room types and hotel-wide blocks.
 *   2. Per-room inventory overrides and date blocks, which are what actually
 *      decide whether a night is bookable.
 *
 * Semantics mirrored from the backend so the UI never promises something the
 * engine will refuse: a block always wins, an absent availability row means
 * "full inventory at standard pricing", and a night's price resolves as
 * priceOverride -> matching seasonal window -> weekend -> seasonal -> base.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { FiCalendar, FiChevronLeft, FiChevronRight, FiLock, FiUnlock } from "react-icons/fi";
import {
  apiErrorMessage,
  hotelApi,
  type AvailabilityBlock,
  type AvailabilityPayload,
  type CalendarResponse,
  type HotelRoom,
} from "../../api/hotel";
import { useHotelDashboard } from "./context";
import { formatDateLabel, money, nightsBetween, todayKey } from "./helpers";
import {
  Alert,
  Button,
  Card,
  Confirm,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "./ui";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const weekdayOf = (key: string) => new Date(`${key}T00:00:00.000Z`).getUTCDay();

const isWeekend = (key: string) => {
  const day = weekdayOf(key);
  return day === 5 || day === 6; // Friday, Saturday
};

/** Shift a `YYYY-MM-DD` key by whole days. */
const shiftKey = (key: string, days: number) => {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

const HotelAvailability = () => {
  const { rooms, refresh } = useHotelDashboard();

  const activeRooms = useMemo(
    () => rooms.filter((room) => !room.isArchived && room.isActive),
    [rooms]
  );

  const [from, setFrom] = useState(() => todayKey());
  const [to, setTo] = useState(() => shiftKey(todayKey(), 30));
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyRoom, setBusyRoom] = useState<string | null>(null);

  const [editing, setEditing] = useState<HotelRoom | null>(null);
  const [unblocking, setUnblocking] = useState<AvailabilityBlock | null>(null);
  const [creatingBlock, setCreatingBlock] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const calendar = await hotelApi.getCalendar(from, to);
      setData(calendar);
      setError("");
    } catch (loadError) {
      setError(apiErrorMessage(loadError, "Could not load the availability calendar."));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const nights = useMemo(() => nightsBetween(from, to), [from, to]);
  const nightCount = nights.length;

  /* ------------------------------ actions ------------------------------ */

  const unblock = async () => {
    if (!unblocking) return;
    setBusyRoom(unblocking._id);
    try {
      const result = await hotelApi.unblockBlock(unblocking._id);
      await Promise.all([load(), refresh()]);
      toast.success(result.message || "Dates unblocked.");
      if (result.warning) toast(result.warning, { icon: "⚠️" });
    } catch (unblockError) {
      toast.error(apiErrorMessage(unblockError, "Could not unblock these dates."));
    } finally {
      setBusyRoom(null);
      setUnblocking(null);
    }
  };

  const deleteBlock = async (block: AvailabilityBlock) => {
    setBusyRoom(block._id);
    try {
      await hotelApi.deleteBlock(block._id);
      await load();
      toast.success("Block removed.");
    } catch (deleteError) {
      toast.error(apiErrorMessage(deleteError, "Could not remove this block."));
    } finally {
      setBusyRoom(null);
    }
  };

  const clearOverrides = async (room: HotelRoom) => {
    setBusyRoom(room._id);
    try {
      const result = await hotelApi.clearRoomAvailability(room._id, from, to);
      await Promise.all([load(), refresh()]);
      toast.success(result.message);
    } catch (clearError) {
      toast.error(apiErrorMessage(clearError, "Could not clear these overrides."));
    } finally {
      setBusyRoom(null);
    }
  };

  /* -------------------------------- view -------------------------------- */

  if (activeRooms.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Availability" />
        <Alert tone="warning">
          You have no active room types yet. Add a room type before managing availability —
          inventory is per room type.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Availability"
        subtitle="Close dates you cannot sell, and adjust per-night inventory and prices. Blocks always win over inventory."
        action={
          <Button type="button" onClick={() => setCreatingBlock(true)}>
            <FiLock size={16} /> Block dates
          </Button>
        }
      />

      {/* ------------------------------ range ------------------------------ */}
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="From (first night)" className="w-full sm:w-48">
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(event) => {
                const next = event.target.value;
                setFrom(next);
                // Keep the window valid: at least one night, never more than a year.
                if (nightsBetween(next, to).length === 0) setTo(shiftKey(next, 30));
                else if (nightsBetween(next, to).length > 366) setTo(shiftKey(next, 366));
              }}
            />
          </Field>

          <Field label="To (checkout)" className="w-full sm:w-48">
            <Input
              type="date"
              value={to}
              min={shiftKey(from, 1)}
              onChange={(event) => {
                const next = event.target.value;
                if (nightsBetween(from, next).length > 366) {
                  setTo(shiftKey(from, 366));
                  return;
                }
                setTo(next);
              }}
            />
          </Field>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const nextFrom = shiftKey(from, -7);
                setFrom(nextFrom);
                setTo(shiftKey(to, -7));
              }}
            >
              <FiChevronLeft size={16} />
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const nextFrom = shiftKey(from, 7);
                setFrom(nextFrom);
                setTo(shiftKey(to, 7));
              }}
            >
              <FiChevronRight size={16} />
            </Button>
          </div>

          <p className="pb-2.5 text-sm text-slate-500">
            {nightCount} night{nightCount === 1 ? "" : "s"}
          </p>
        </div>

        {nightCount > 366 && (
          <div className="mt-4">
            <Alert tone="warning">A calendar window is limited to 366 nights.</Alert>
          </div>
        )}
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}

      {/* ----------------------------- calendar ----------------------------- */}
      <Card
        title="Hotel calendar"
        description="Free rooms per night across every active room type."
        action={
          <Button type="button" variant="ghost" onClick={() => void load()}>
            Refresh
          </Button>
        }
      >
        {loading ? (
          <Spinner label="Loading calendar…" />
        ) : !data || data.calendar.length === 0 ? (
          <Alert tone="info">No nights in this window.</Alert>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2.5 pr-4 font-semibold">Night</th>
                  <th className="py-2.5 pr-4 font-semibold">Free / total</th>
                  <th className="py-2.5 pr-4 font-semibold">Status</th>
                  <th className="py-2.5 pr-4 font-semibold">Min stay</th>
                  <th className="py-2.5 font-semibold">Sold-out types</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.calendar.map((night) => {
                  const soldOut = night.isHotelBlocked || night.available === 0;
                  return (
                    <tr key={night.date} className={soldOut ? "bg-rose-50/40" : ""}>
                      <td className="py-2.5 pr-4">
                        <span className="font-semibold text-slate-800">
                          {formatDateLabel(night.date)}
                        </span>
                        <span className="ml-2 text-xs text-slate-400">
                          {DAY_NAMES[weekdayOf(night.date)]}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">
                        {night.available} / {night.total}
                      </td>
                      <td className="py-2.5 pr-4">
                        {night.isHotelBlocked ? (
                          <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-800">
                            Hotel blocked
                          </span>
                        ) : night.available === 0 ? (
                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                            Sold out
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                            Open
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">{data.policy.minStayNights}</td>
                      <td className="py-2.5 text-slate-600">
                        {night.soldOutRoomTypes || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data?.policy && (
          <p className="mt-4 text-sm text-slate-500">
            Check-in {data.policy.checkInTime} · check-out {data.policy.checkOutTime} · stays of{" "}
            {data.policy.minStayNights}–{data.policy.maxStayNights} nights
          </p>
        )}
      </Card>

      {/* ------------------------------ rooms ------------------------------ */}
      <Card
        title="Per-room inventory"
        description="Set how many rooms of a type are sellable on each night, or override the price and minimum stay."
      >
        <ul className="space-y-4">
          {activeRooms.map((room) => {
            const overrideCount = (data?.overrides ?? []).filter(
              (row) => row.roomTypeId === room._id
            ).length;
            const blockCount = (data?.blocks ?? []).filter(
              (block) => block.roomTypeId === room._id
            ).length;

            return (
              <li
                key={room._id}
                className="rounded-xl border border-slate-100 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-800">{room.name}</p>
                    <p className="text-sm text-slate-500">
                      {room.totalRooms} in inventory · {money(room.pricing?.basePrice)} per night
                      {room.pricing?.weekendPrice != null &&
                        ` · ${money(room.pricing.weekendPrice)} on weekends`}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setEditing(room)}
                      className="!px-3 !py-1.5"
                    >
                      <FiCalendar size={14} /> Set availability
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => void clearOverrides(room)}
                      disabled={overrideCount === 0 || busyRoom === room._id}
                      className="!px-3 !py-1.5"
                      title="Reset this room's overrides in the selected window"
                    >
                      Reset ({overrideCount})
                    </Button>
                  </div>
                </div>

                {blockCount > 0 && (
                  <p className="mt-2 text-xs font-semibold text-rose-600">
                    {blockCount} active date block{blockCount === 1 ? "" : "s"} affect this room
                  </p>
                )}

                {overrideCount > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {(data?.overrides ?? [])
                      .filter((row) => row.roomTypeId === room._id)
                      .map((row) => (
                        <li
                          key={`${room._id}-${row.date}`}
                          className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600"
                        >
                          <span className="font-semibold">{formatDateLabel(row.date)}</span> ·{" "}
                          {row.availableCount ?? "full"} free
                          {row.priceOverride != null && ` · ${money(row.priceOverride)}`}
                          {row.status === "blocked" && " · blocked"}
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* ------------------------------ blocks ------------------------------ */}
      <Card title="Date blocks" description="Blocks close a range for the whole hotel or a single room type.">
        {(data?.blocks ?? []).length === 0 ? (
          <Alert tone="info">
            No blocks overlap this window. Use “Block dates” to close maintenance days, festivals
            or dates you are fully booked.
          </Alert>
        ) : (
          <ul className="space-y-3">
            {(data?.blocks ?? []).map((block) => (
              <li
                key={block._id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-4"
              >
                <div>
                  <p className="font-semibold text-slate-800">
                    {formatDateLabel(block.startDate)} → {formatDateLabel(block.endDate)}
                  </p>
                  <p className="text-sm text-slate-500">
                    {block.scope === "hotel" ? "Whole property" : block.roomName || "Room type"}
                    {block.reason ? ` · ${block.reason}` : ""}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setUnblocking(block)}
                    className="!px-3 !py-1.5"
                  >
                    <FiUnlock size={14} /> Unblock
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void deleteBlock(block)}
                    disabled={busyRoom === block._id}
                    className="!px-3 !py-1.5"
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ------------------------------ modals ------------------------------ */}
      <SetAvailabilityModal
        room={editing}
        from={from}
        to={to}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await Promise.all([load(), refresh()]);
        }}
      />

      <CreateBlockModal
        open={creatingBlock}
        rooms={activeRooms}
        defaultStart={from}
        defaultEnd={to}
        onClose={() => setCreatingBlock(false)}
        onSaved={async () => {
          setCreatingBlock(false);
          await load();
        }}
      />

      <Confirm
        open={Boolean(unblocking)}
        title="Unblock these dates?"
        message="Inventory and price overrides that were held back by the block stay in place — you may need to reset them separately to fully reopen the nights."
        confirmLabel="Unblock"
        tone="primary"
        busy={Boolean(busyRoom)}
        onCancel={() => setUnblocking(null)}
        onConfirm={() => void unblock()}
      />

      {nightCount > 0 && (
        <p className="text-center text-xs text-slate-400">
          Showing {nightCount} night{nightCount === 1 ? "" : "s"} from {formatDateLabel(from)} to{" "}
          {formatDateLabel(to)}. {isWeekend(from) ? "Weekend pricing applies to Fri & Sat." : ""}
        </p>
      )}
    </div>
  );
};

export default HotelAvailability;

/* ------------------------------------------------------------------ */
/* Set inventory / price overrides for one room                         */
/* ------------------------------------------------------------------ */

interface SetAvailabilityModalProps {
  room: HotelRoom | null;
  from: string;
  to: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

const SetAvailabilityModal = ({ room, from, to, onClose, onSaved }: SetAvailabilityModalProps) => {
  const [availableCount, setAvailableCount] = useState("");
  const [priceOverride, setPriceOverride] = useState("");
  const [minStayOverride, setMinStayOverride] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setAvailableCount("");
    setPriceOverride("");
    setMinStayOverride("");
    setNote("");
    setError("");
  }, [room]);

  const nights = useMemo(() => nightsBetween(from, to), [from, to]);

  const save = async () => {
    if (!room) return;

    const payload: AvailabilityPayload = {};
    if (availableCount.trim() !== "") payload.availableCount = Number(availableCount);
    if (priceOverride.trim() !== "") payload.priceOverride = Number(priceOverride);
    if (minStayOverride.trim() !== "") payload.minStayOverride = Number(minStayOverride);
    if (note.trim() !== "") payload.note = note.trim();

    if (Object.keys(payload).length === 0) {
      setError("Provide at least one value to change.");
      return;
    }
    if (
      payload.availableCount !== undefined &&
      (payload.availableCount < 0 || payload.availableCount > room.totalRooms)
    ) {
      setError(`Available rooms must be between 0 and ${room.totalRooms}.`);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await hotelApi.setRoomAvailability(room._id, from, to, payload);
      toast.success(result.message || "Availability updated.");
      await onSaved();
    } catch (saveError) {
      const message = apiErrorMessage(saveError, "Could not update availability.");
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(room)}
      title={room ? `Availability — ${room.name}` : "Availability"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" busy={saving} onClick={() => void save()}>
            Apply to {nights.length} night{nights.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      {room && (
        <div className="space-y-5">
          <Alert tone="info">
            Changes apply to every night from {formatDateLabel(from)} to {formatDateLabel(to)} (
            {nights.length} night{nights.length === 1 ? "" : "s"}). Leave a field blank to keep its
            current value. Nights that are blocked or already booked are refused.
          </Alert>

          {error && <Alert tone="danger">{error}</Alert>}

          <Field
            label="Available rooms per night"
            hint={`0 – ${room.totalRooms}. 0 sells the whole window out.`}
          >
            <Input
              type="number"
              min={0}
              max={room.totalRooms}
              value={availableCount}
              onChange={(event) => setAvailableCount(event.target.value)}
              placeholder="unchanged"
            />
          </Field>

          <Field
            label="Price override"
            hint={`Replaces every price rule for these nights. Base is ${money(
              room.pricing?.basePrice
            )}.`}
          >
            <Input
              type="number"
              min={0}
              value={priceOverride}
              onChange={(event) => setPriceOverride(event.target.value)}
              placeholder="unchanged"
            />
          </Field>

          <Field label="Minimum stay override" hint="1 – 365 nights.">
            <Input
              type="number"
              min={1}
              max={365}
              value={minStayOverride}
              onChange={(event) => setMinStayOverride(event.target.value)}
              placeholder="unchanged"
            />
          </Field>

          <Field label="Internal note">
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder="e.g. closed for maintenance"
            />
          </Field>
        </div>
      )}
    </Modal>
  );
};

/* ------------------------------------------------------------------ */
/* Create a date block                                                  */
/* ------------------------------------------------------------------ */

interface CreateBlockModalProps {
  open: boolean;
  rooms: HotelRoom[];
  defaultStart: string;
  defaultEnd: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

const CreateBlockModal = ({
  open,
  rooms,
  defaultStart,
  defaultEnd,
  onClose,
  onSaved,
}: CreateBlockModalProps) => {
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [scope, setScope] = useState("hotel");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setStartDate(defaultStart);
    setEndDate(defaultEnd);
    setScope("hotel");
    setReason("");
    setError("");
  }, [open, defaultStart, defaultEnd]);

  const save = async () => {
    if (endDate < startDate) {
      setError("The end date cannot be before the start date.");
      return;
    }
    if (startDate < todayKey()) {
      setError("Blocks cannot start in the past.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await hotelApi.createBlock({
        startDate,
        endDate,
        reason: reason.trim() || undefined,
        roomTypeId: scope === "hotel" ? null : scope,
      });
      toast.success("Dates blocked.");
      await onSaved();
    } catch (saveError) {
      const message = apiErrorMessage(saveError, "Could not block these dates.");
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Block dates"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" busy={saving} onClick={() => void save()}>
            Block dates
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Alert tone="info">
          A block always wins over inventory. While it is active, the nights cannot be booked —
          even if rooms are still marked free.
        </Alert>

        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Applies to">
          <Select value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="hotel">Whole property</option>
            {rooms.map((room) => (
              <option key={room._id} value={room._id}>
                {room.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Start date" required>
            <Input
              type="date"
              value={startDate}
              min={todayKey()}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>

          <Field label="End date" required hint="The last blocked day.">
            <Input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </Field>
        </div>

        <Field label="Reason" hint="Shown to your team and admins. Optional.">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="e.g. Annual maintenance"
          />
        </Field>
      </div>
    </Modal>
  );
};
