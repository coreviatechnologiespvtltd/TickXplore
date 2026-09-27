/**
 * Hotel dashboard — room types.
 * ------------------------------------------------------------------
 * Room inventory CRUD. Deleting is a soft-archive by default (the backend
 * hard-deletes only when a room has never had availability or bookings), so
 * the UI offers "Archive" as the normal action and "Delete permanently" only
 * after an explicit warning.
 */
import { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { FiArchive, FiEdit2, FiPlusCircle, FiRefreshCw, FiTrash2 } from "react-icons/fi";
import {
  apiErrorMessage,
  hotelApi,
  imageSrc,
  type HotelRoom,
  type ReadinessIssue,
} from "../../api/hotel";
import { useHotelDashboard } from "./context";
import { money } from "./helpers";
import RoomEditorModal from "./RoomEditorModal";
import {
  Alert,
  Button,
  Card,
  Confirm,
  EmptyState,
  Input,
  PageHeader,
} from "./ui";

type Filter = "active" | "inactive" | "archived" | "all";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

const ACCEPTED = "image/jpeg,image/png,image/webp,image/avif";
const MAX_ROOM_IMAGES = 8;
const MAX_BYTES = 5 * 1024 * 1024;

const HotelRooms = () => {
  const { rooms, readiness, refresh } = useHotelDashboard();

  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<HotelRoom | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<HotelRoom | null>(null);
  const [purging, setPurging] = useState<HotelRoom | null>(null);
  const [restoring, setRestoring] = useState<HotelRoom | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageBusyId, setImageBusyId] = useState<string | null>(null);

  /** Rooms with readiness problems, keyed so the row can show what is missing. */
  const roomIssues = useMemo(() => {
    const map = new Map<string, ReadinessIssue[]>();
    for (const issue of readiness?.blockers ?? []) {
      if (!issue.roomId) continue;
      map.set(issue.roomId, [...(map.get(issue.roomId) ?? []), issue]);
    }
    return map;
  }, [readiness]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rooms.filter((room) => {
      if (filter === "active" && (room.isArchived || !room.isActive)) return false;
      if (filter === "inactive" && (room.isArchived || room.isActive)) return false;
      if (filter === "archived" && !room.isArchived) return false;
      if (term && !room.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rooms, filter, search]);

  /* ------------------------------ actions ------------------------------ */

  const archiveRoom = async () => {
    if (!archiving) return;
    setBusy(true);
    try {
      await hotelApi.deleteRoom(archiving._id);
      await refresh();
      toast.success(`"${archiving.name}" archived.`);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not archive the room."));
    } finally {
      setBusy(false);
      setArchiving(null);
    }
  };

  const purgeRoom = async () => {
    if (!purging) return;
    setBusy(true);
    try {
      await hotelApi.deleteRoom(purging._id, true);
      await refresh();
      toast.success(`"${purging.name}" deleted permanently.`);
    } catch (error) {
      toast.error(
        apiErrorMessage(
          error,
          "This room has history and can only be archived, not deleted."
        )
      );
    } finally {
      setBusy(false);
      setPurging(null);
    }
  };

  const restoreRoom = async () => {
    if (!restoring) return;
    setBusy(true);
    try {
      await hotelApi.restoreRoom(restoring._id, true);
      await refresh();
      toast.success(`"${restoring.name}" restored and set to active.`);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not restore the room."));
    } finally {
      setBusy(false);
      setRestoring(null);
    }
  };

  /* ------------------------------ images ------------------------------ */

  const uploadImages = async (room: HotelRoom, files: FileList | null) => {
    if (!files || files.length === 0) return;
    if ((room.images?.length ?? 0) + files.length > MAX_ROOM_IMAGES) {
      toast.error(`A room can have at most ${MAX_ROOM_IMAGES} images.`);
      return;
    }
    for (const file of Array.from(files)) {
      if (!ACCEPTED.split(",").includes(file.type)) {
        toast.error(`"${file.name}" is not a JPEG, PNG, WebP or AVIF image.`);
        return;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`"${file.name}" is larger than 5MB.`);
        return;
      }
    }

    setImageBusyId(room._id);
    try {
      await hotelApi.uploadRoomImages(room._id, files);
      await refresh();
      toast.success("Room photos uploaded.");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not upload the room photos."));
    } finally {
      setImageBusyId(null);
    }
  };

  const setCover = async (room: HotelRoom, imageId: string) => {
    setImageBusyId(room._id);
    try {
      await hotelApi.setRoomCover(room._id, imageId);
      await refresh();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not update the room cover."));
    } finally {
      setImageBusyId(null);
    }
  };

  const deleteImage = async (room: HotelRoom, imageId: string) => {
    setImageBusyId(room._id);
    try {
      await hotelApi.deleteRoomImage(room._id, imageId);
      await refresh();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not remove the room photo."));
    } finally {
      setImageBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Room types"
        subtitle="Each room type is a sellable category with its own inventory, pricing and photos."
        action={
          <Button type="button" onClick={() => setCreating(true)}>
            <FiPlusCircle size={16} /> Add room type
          </Button>
        }
      />

      {(readiness?.blockers ?? []).some((issue) => issue.roomId) && (
        <Alert tone="warning">
          Some rooms are missing required details (description, price, inventory or photos). The
          issues are listed on the affected room below.
        </Alert>
      )}

      {/* ------------------------------ toolbar ------------------------------ */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
                filter === option.value
                  ? "bg-teal-600 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search rooms…"
          className="max-w-xs"
        />

        <Button variant="ghost" onClick={() => void refresh()} title="Refresh">
          <FiRefreshCw size={16} />
        </Button>
      </div>

      {/* ------------------------------- list ------------------------------- */}
      {visible.length === 0 ? (
        <EmptyState
          title={rooms.length === 0 ? "No room types yet" : "No rooms match this filter"}
          message={
            rooms.length === 0
              ? "Add your first room type with its description, price and inventory. You need at least one active room before your listing can be submitted."
              : "Try a different filter or clear the search."
          }
          action={
            rooms.length === 0 ? (
              <Button type="button" onClick={() => setCreating(true)}>
                <FiPlusCircle size={16} /> Add room type
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-4">
          {visible.map((room) => {
            const issues = roomIssues.get(room._id) ?? [];
            const images = [...(room.images ?? [])].sort((a, b) => a.order - b.order);

            return (
              <li key={room._id}>
                <Card>
                  <div className="flex flex-col gap-5 lg:flex-row">
                    {/* photos */}
                    <div className="flex shrink-0 gap-2 lg:w-64">
                      <div className="flex-1 space-y-2">
                        {images.slice(0, 2).map((image) => (
                          <div key={image._id} className="relative">
                            <img
                              src={imageSrc(image.url)}
                              alt={room.name}
                              className="h-20 w-full rounded-lg object-cover"
                            />
                            {image.isCover && (
                              <span className="absolute left-1.5 top-1.5 rounded-full bg-teal-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
                                Cover
                              </span>
                            )}
                          </div>
                        ))}
                        {images.length === 0 && (
                          <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-slate-200 text-[11px] font-semibold text-slate-400">
                            No photos
                          </div>
                        )}
                        <label className="block cursor-pointer rounded-lg border border-dashed border-slate-200 px-2 py-1.5 text-center text-[11px] font-semibold text-slate-500 transition-colors hover:border-teal-300 hover:text-teal-600">
                          {imageBusyId === room._id ? "Uploading…" : "+ Add photo"}
                          <input
                            type="file"
                            accept={ACCEPTED}
                            multiple
                            className="hidden"
                            onChange={(event) => void uploadImages(room, event.target.files)}
                          />
                        </label>
                      </div>

                      <div className="space-y-1.5">
                        {images.slice(0, 2).map((image) => (
                          <div key={image._id} className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => void setCover(room, image._id)}
                              disabled={imageBusyId === room._id || image.isCover}
                              title="Set as cover"
                              className="rounded-md bg-slate-100 px-1.5 py-1 text-[10px] font-semibold text-slate-600 transition-colors hover:bg-teal-100 hover:text-teal-700 disabled:opacity-40"
                            >
                              ★
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteImage(room, image._id)}
                              disabled={imageBusyId === room._id}
                              title="Delete photo"
                              className="rounded-md bg-slate-100 px-1.5 py-1 text-[10px] font-semibold text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-40"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-bold text-slate-900">{room.name}</h3>
                          <p className="text-sm text-slate-500">
                            {room.type} · sleeps {room.maxGuests} · {room.totalRooms} in inventory
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {room.isArchived ? (
                            <span className="rounded-full bg-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                              Archived
                            </span>
                          ) : room.isActive ? (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                              Active
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700">
                              Hidden
                            </span>
                          )}

                          {!room.isArchived && (
                            <>
                              <Button
                                variant="secondary"
                                onClick={() => setEditing(room)}
                                className="!px-3 !py-1.5"
                              >
                                <FiEdit2 size={14} /> Edit
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => setArchiving(room)}
                                className="!px-3 !py-1.5"
                              >
                                <FiArchive size={14} /> Archive
                              </Button>
                            </>
                          )}

                          {room.isArchived ? (
                            <Button
                              variant="secondary"
                              onClick={() => setRestoring(room)}
                              className="!px-3 !py-1.5"
                            >
                              <FiRefreshCw size={14} /> Restore
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              onClick={() => setPurging(room)}
                              title="Delete permanently"
                              className="!px-3 !py-1.5"
                            >
                              <FiTrash2 size={14} />
                            </Button>
                          )}
                        </div>
                      </div>

                      {room.description && (
                        <p className="mt-3 line-clamp-2 text-sm text-slate-600">
                          {room.description}
                        </p>
                      )}

                      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            Base price
                          </p>
                          <p className="text-sm font-bold text-slate-800">
                            {money(room.pricing?.basePrice)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            Weekend
                          </p>
                          <p className="text-sm font-bold text-slate-800">
                            {room.pricing?.weekendPrice != null
                              ? money(room.pricing.weekendPrice)
                              : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            Beds
                          </p>
                          <p className="text-sm font-bold text-slate-800">
                            {room.beds?.length
                              ? room.beds
                                  .map((bed) => `${bed.count}× ${bed.type}`)
                                  .join(", ")
                              : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            Earnings
                          </p>
                          <p className="text-sm font-bold text-slate-800">
                            {money(room.totalEarnings)}
                          </p>
                        </div>
                      </div>

                      {room.pricing?.seasonalRates?.length > 0 && (
                        <p className="mt-3 text-xs text-slate-500">
                          {room.pricing.seasonalRates.length} seasonal rate window(s) configured
                        </p>
                      )}

                      {issues.length > 0 && (
                        <ul className="mt-3 space-y-1">
                          {issues.map((issue, index) => (
                            <li
                              key={`${room._id}-issue-${index}`}
                              className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-700"
                            >
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* ------------------------------ modals ------------------------------ */}
      <RoomEditorModal
        open={creating}
        room={null}
        onClose={() => setCreating(false)}
        onSaved={async () => {
          setCreating(false);
          await refresh();
        }}
      />

      <RoomEditorModal
        open={Boolean(editing)}
        room={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
        }}
      />

      <Confirm
        open={Boolean(archiving)}
        title="Archive this room type?"
        message={`"${archiving?.name}" will be hidden from the dashboard and the public site. Its availability and booking history are preserved, and you can restore it later.`}
        confirmLabel="Archive"
        busy={busy}
        onCancel={() => setArchiving(null)}
        onConfirm={() => void archiveRoom()}
      />

      <Confirm
        open={Boolean(restoring)}
        title="Restore this room type?"
        message={`"${restoring?.name}" will be restored as an active room. Remember to submit your listing again so the change is approved.`}
        confirmLabel="Restore"
        tone="primary"
        busy={busy}
        onCancel={() => setRestoring(null)}
        onConfirm={() => void restoreRoom()}
      />

      <Confirm
        open={Boolean(purging)}
        title="Delete this room type permanently?"
        message="This is only possible for rooms that have never had availability or bookings. If the room has history it will be archived instead of deleted."
        confirmLabel="Delete permanently"
        requireText="DELETE"
        busy={busy}
        onCancel={() => setPurging(null)}
        onConfirm={() => void purgeRoom()}
      />

      {purging && (
        <p className="sr-only" aria-live="polite">
          Confirming permanent deletion of {purging.name}
        </p>
      )}
    </div>
  );
};

export default HotelRooms;
