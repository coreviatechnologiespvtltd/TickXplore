/**
 * Room type create / edit modal.
 * ------------------------------------------------------------------
 * Used for both `POST /rooms` and `PUT /rooms/:id`. The form mirrors the
 * backend's own validation (beds must sleep `maxGuests`, attached bathrooms
 * cannot exceed total bathrooms, etc.) so the common mistakes are caught before
 * a round trip, and every rule the server owns is surfaced from its error
 * message rather than duplicated here.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { FiPlus, FiTrash2 } from "react-icons/fi";
import {
  apiErrorMessage,
  hotelApi,
  ROOM_CATEGORIES,
  BED_TYPES,
  type AmenityEntry,
  type BedEntry,
  type BedType,
  type HotelRoom,
  type RoomCategory,
  type SeasonalRate,
} from "../../api/hotel";
import {
  Alert,
  AmenityPicker,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from "./ui";

/* ------------------------------------------------------------------ */
/* Form state                                                           */
/* ------------------------------------------------------------------ */

interface RateDraft {
  key: string;
  name: string;
  startDate: string;
  endDate: string;
  price: string;
  minStayNights: string;
}

interface RoomForm {
  name: string;
  description: string;
  type: RoomCategory;
  totalRooms: string;
  maxGuests: string;
  maxAdults: string;
  maxChildren: string;
  bedrooms: string;
  bathrooms: string;
  attachedBathrooms: string;
  sizeSqm: string;
  isActive: boolean;
  beds: Array<{ key: string; type: BedType; count: string }>;
  amenities: string[];
  basePrice: string;
  weekendPrice: string;
  seasonalPrice: string;
  extraGuestPrice: string;
  childPrice: string;
  discountPercent: string;
  taxPercent: string;
  serviceFeePercent: string;
  rates: RateDraft[];
}

const rateKey = () => `rate-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const emptyForm = (): RoomForm => ({
  name: "",
  description: "",
  type: "Standard",
  totalRooms: "1",
  maxGuests: "2",
  maxAdults: "",
  maxChildren: "0",
  bedrooms: "1",
  bathrooms: "1",
  attachedBathrooms: "0",
  sizeSqm: "",
  isActive: true,
  beds: [{ key: "bed-1", type: "king", count: "1" }],
  amenities: [],
  basePrice: "",
  weekendPrice: "",
  seasonalPrice: "",
  extraGuestPrice: "0",
  childPrice: "0",
  discountPercent: "0",
  taxPercent: "0",
  serviceFeePercent: "0",
  rates: [],
});

/** `null` / `""` means "fall back to the base price" on the backend. */
const numOrNull = (value: string) => (value.trim() === "" ? null : Number(value));

const toForm = (room: HotelRoom): RoomForm => ({
  name: room.name,
  description: room.description ?? "",
  type: room.type ?? "Standard",
  totalRooms: String(room.totalRooms ?? 1),
  maxGuests: String(room.maxGuests ?? 2),
  maxAdults: room.maxAdults != null ? String(room.maxAdults) : "",
  maxChildren: String(room.maxChildren ?? 0),
  bedrooms: String(room.bedrooms ?? 1),
  bathrooms: String(room.bathrooms ?? 1),
  attachedBathrooms: String(room.attachedBathrooms ?? 0),
  sizeSqm: room.sizeSqm != null ? String(room.sizeSqm) : "",
  isActive: room.isActive ?? true,
  beds: (room.beds ?? []).map((bed, index) => ({
    key: `bed-${index}`,
    type: bed.type,
    count: String(bed.count),
  })),
  amenities: room.amenities ?? [],
  basePrice: String(room.pricing?.basePrice ?? 0),
  weekendPrice: room.pricing?.weekendPrice != null ? String(room.pricing.weekendPrice) : "",
  seasonalPrice: room.pricing?.seasonalPrice != null ? String(room.pricing.seasonalPrice) : "",
  extraGuestPrice: String(room.pricing?.extraGuestPrice ?? 0),
  childPrice: String(room.pricing?.childPrice ?? 0),
  discountPercent: String(room.pricing?.discountPercent ?? 0),
  taxPercent: String(room.pricing?.taxPercent ?? 0),
  serviceFeePercent: String(room.pricing?.serviceFeePercent ?? 0),
  rates: (room.pricing?.seasonalRates ?? []).map((rate: SeasonalRate) => ({
    key: rate._id ?? rateKey(),
    name: rate.name ?? "",
    startDate: rate.startDate ? rate.startDate.slice(0, 10) : "",
    endDate: rate.endDate ? rate.endDate.slice(0, 10) : "",
    price: String(rate.price ?? 0),
    minStayNights: rate.minStayNights != null ? String(rate.minStayNights) : "",
  })),
});

/* ------------------------------------------------------------------ */
/* Local validation mirroring the schema rules                          */
/* ------------------------------------------------------------------ */

/** Beds sleep 2 each, except singles and bunks which sleep 1. */
const bedCapacity = (beds: RoomForm["beds"]) =>
  beds.reduce(
    (sum, bed) =>
      sum + Number(bed.count || 0) * (bed.type === "single" || bed.type === "bunk" ? 1 : 2),
    0
  );

interface RoomEditorModalProps {
  open: boolean;
  /** `null` creates a new room type. */
  room: HotelRoom | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

const RoomEditorModal = ({ open, room, onClose, onSaved }: RoomEditorModalProps) => {
  const [form, setForm] = useState<RoomForm>(emptyForm);
  const [catalog, setCatalog] = useState<AmenityEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(room ? toForm(room) : emptyForm());
      setServerError("");
    }
  }, [open, room]);

  useEffect(() => {
    if (!open) return;
    hotelApi.amenities("room").then(setCatalog).catch(() => setCatalog([]));
  }, [open]);

  const set = <K extends keyof RoomForm>(key: K, value: RoomForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /* ------------------------------ validation ------------------------------ */

  const errors = useMemo(() => {
    const list: string[] = [];
    const guests = Number(form.maxGuests || 0);

    if (form.name.trim().length < 2) list.push("Room name must be at least 2 characters.");
    if (form.description.trim().length < 10)
      list.push("Description must be at least 10 characters.");
    if (Number(form.totalRooms || 0) < 1) list.push("Inventory must be at least 1 room.");
    if (guests < 1) list.push("Maximum guests must be at least 1.");
    if (form.maxAdults && Number(form.maxAdults) > guests)
      list.push("Maximum adults cannot exceed maximum guests.");
    if (form.maxChildren && Number(form.maxChildren) > guests)
      list.push("Maximum children cannot exceed maximum guests.");
    if (form.attachedBathrooms && Number(form.attachedBathrooms) > Number(form.bathrooms || 0))
      list.push("Attached bathrooms cannot exceed total bathrooms.");
    if (form.beds.length > 0 && bedCapacity(form.beds) < guests) {
      list.push(
        `The configured beds sleep ${bedCapacity(form.beds)} guest(s) but maximum guests is ${guests}.`
      );
    }
    if (form.basePrice.trim() === "" || Number(form.basePrice) < 0)
      list.push("A base price is required.");

    for (const rate of form.rates) {
      if (!rate.startDate || !rate.endDate) {
        list.push("Every seasonal rate needs a start and end date.");
        break;
      }
      if (rate.endDate < rate.startDate) {
        list.push("A seasonal rate cannot end before it starts.");
        break;
      }
    }

    return list;
  }, [form]);

  /* -------------------------------- save -------------------------------- */

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }

    const beds: BedEntry[] = form.beds
      .filter((bed) => bed.type && Number(bed.count) > 0)
      .map((bed) => ({ type: bed.type, count: Number(bed.count) }));

    const seasonalRates = form.rates
      .filter((rate) => rate.startDate && rate.endDate)
      .map((rate) => ({
        name: rate.name.trim(),
        startDate: rate.startDate,
        endDate: rate.endDate,
        price: Number(rate.price || 0),
        minStayNights: rate.minStayNights.trim() === "" ? null : Number(rate.minStayNights),
      }));

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      type: form.type,
      totalRooms: Number(form.totalRooms),
      maxGuests: Number(form.maxGuests),
      maxAdults: numOrNull(form.maxAdults),
      maxChildren: form.maxChildren.trim() === "" ? 0 : Number(form.maxChildren),
      bedrooms: Number(form.bedrooms || 0),
      bathrooms: Number(form.bathrooms || 0),
      attachedBathrooms: Number(form.attachedBathrooms || 0),
      sizeSqm: numOrNull(form.sizeSqm),
      isActive: form.isActive,
      beds,
      amenities: form.amenities,
      pricing: {
        basePrice: Number(form.basePrice),
        weekendPrice: numOrNull(form.weekendPrice),
        seasonalPrice: numOrNull(form.seasonalPrice),
        extraGuestPrice: Number(form.extraGuestPrice || 0),
        childPrice: Number(form.childPrice || 0),
        discountPercent: Number(form.discountPercent || 0),
        taxPercent: Number(form.taxPercent || 0),
        serviceFeePercent: Number(form.serviceFeePercent || 0),
        seasonalRates,
      },
    };

    setSaving(true);
    setServerError("");
    try {
      if (room) await hotelApi.updateRoom(room._id, payload);
      else await hotelApi.createRoom(payload);

      toast.success(room ? "Room type updated." : "Room type created.");
      await onSaved();
    } catch (error) {
      const message = apiErrorMessage(error, "Could not save the room type.");
      setServerError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------ helpers ------------------------------ */

  const updateBed = (key: string, patch: Partial<RoomForm["beds"][number]>) =>
    setForm((prev) => ({
      ...prev,
      beds: prev.beds.map((bed) => (bed.key === key ? { ...bed, ...patch } : bed)),
    }));

  const addBed = () =>
    setForm((prev) => ({
      ...prev,
      beds: [...prev.beds, { key: rateKey(), type: "single", count: "1" }],
    }));

  const removeBed = (key: string) =>
    setForm((prev) => ({ ...prev, beds: prev.beds.filter((bed) => bed.key !== key) }));

  const updateRate = (key: string, patch: Partial<RateDraft>) =>
    setForm((prev) => ({
      ...prev,
      rates: prev.rates.map((rate) => (rate.key === key ? { ...rate, ...patch } : rate)),
    }));

  const addRate = () =>
    setForm((prev) => ({
      ...prev,
      rates: [
        ...prev.rates,
        { key: rateKey(), name: "", startDate: "", endDate: "", price: "0", minStayNights: "" },
      ],
    }));

  const removeRate = (key: string) =>
    setForm((prev) => ({ ...prev, rates: prev.rates.filter((rate) => rate.key !== key) }));

  return (
    <Modal
      open={open}
      wide
      title={room ? `Edit “${room.name}”` : "Add room type"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="room-editor" busy={saving} disabled={errors.length > 0}>
            {room ? "Save changes" : "Create room"}
          </Button>
        </>
      }
    >
      <form id="room-editor" onSubmit={handleSubmit} className="space-y-6">
        {serverError && <Alert tone="danger">{serverError}</Alert>}

        {/* -------------------------- basics -------------------------- */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Room name" required hint="Must be unique across your hotel.">
            <Input
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
              maxLength={120}
              placeholder="e.g. Deluxe Double View"
            />
          </Field>

          <Field label="Category">
            <Select
              value={form.type}
              onChange={(event) => set("type", event.target.value as RoomCategory)}
            >
              {ROOM_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Description" required hint="At least 10 characters.">
          <Textarea
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="What makes this room different? Size, view, layout, bedding…"
          />
        </Field>

        {/* ------------------------ inventory ------------------------ */}
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <Field label="Rooms in inventory" required hint="1 – 500">
            <Input
              type="number"
              min={1}
              max={500}
              value={form.totalRooms}
              onChange={(event) => set("totalRooms", event.target.value)}
            />
          </Field>

          <Field label="Max guests" required>
            <Input
              type="number"
              min={1}
              max={50}
              value={form.maxGuests}
              onChange={(event) => set("maxGuests", event.target.value)}
            />
          </Field>

          <Field label="Max adults" hint="Blank = same as guests">
            <Input
              type="number"
              min={0}
              max={50}
              value={form.maxAdults}
              onChange={(event) => set("maxAdults", event.target.value)}
            />
          </Field>

          <Field label="Max children">
            <Input
              type="number"
              min={0}
              max={50}
              value={form.maxChildren}
              onChange={(event) => set("maxChildren", event.target.value)}
            />
          </Field>

          <Field label="Bedrooms">
            <Input
              type="number"
              min={0}
              max={20}
              value={form.bedrooms}
              onChange={(event) => set("bedrooms", event.target.value)}
            />
          </Field>

          <Field label="Bathrooms">
            <Input
              type="number"
              min={0}
              max={20}
              value={form.bathrooms}
              onChange={(event) => set("bathrooms", event.target.value)}
            />
          </Field>

          <Field label="Attached bathrooms">
            <Input
              type="number"
              min={0}
              max={20}
              value={form.attachedBathrooms}
              onChange={(event) => set("attachedBathrooms", event.target.value)}
            />
          </Field>

          <Field label="Size (m²)">
            <Input
              type="number"
              min={0}
              value={form.sizeSqm}
              onChange={(event) => set("sizeSqm", event.target.value)}
            />
          </Field>
        </div>

        {/* --------------------------- beds --------------------------- */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">Beds</p>
            <Button type="button" variant="secondary" onClick={addBed} className="!px-3 !py-1.5">
              <FiPlus size={14} /> Add bed
            </Button>
          </div>

          {form.beds.length === 0 ? (
            <p className="text-xs text-slate-500">
              No beds configured. Sleeping capacity is not checked when the list is empty.
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {form.beds.map((bed) => (
                  <li key={bed.key} className="flex items-end gap-2">
                    <Select
                      value={bed.type}
                      onChange={(event) =>
                        updateBed(bed.key, { type: event.target.value as BedType })
                      }
                      className="flex-1"
                    >
                      {BED_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </Select>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={bed.count}
                      onChange={(event) => updateBed(bed.key, { count: event.target.value })}
                      className="w-24"
                      aria-label="Bed count"
                    />
                    <button
                      type="button"
                      onClick={() => removeBed(bed.key)}
                      aria-label="Remove bed"
                      className="mb-1 rounded-lg p-2 text-rose-500 transition-colors hover:bg-rose-50"
                    >
                      <FiTrash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
              {form.maxGuests && (
                <p className="mt-2 text-xs text-slate-500">
                  These beds sleep {bedCapacity(form.beds)} guest(s). Maximum guests is{" "}
                  {form.maxGuests}.
                </p>
              )}
            </>
          )}
        </div>

        {/* ------------------------- pricing ------------------------- */}
        <div className="rounded-xl border border-slate-100 p-4">
          <p className="mb-3 text-sm font-semibold text-slate-700">Pricing (per night)</p>

          <div className="grid grid-cols-2 gap-5 md:grid-cols-3">
            <Field label="Base price" required hint="Required">
              <Input
                type="number"
                min={0}
                value={form.basePrice}
                onChange={(event) => set("basePrice", event.target.value)}
              />
            </Field>

            <Field label="Weekend price" hint="Fri & Sat. Blank = base price.">
              <Input
                type="number"
                min={0}
                value={form.weekendPrice}
                onChange={(event) => set("weekendPrice", event.target.value)}
              />
            </Field>

            <Field label="Seasonal price" hint="Blank = base price.">
              <Input
                type="number"
                min={0}
                value={form.seasonalPrice}
                onChange={(event) => set("seasonalPrice", event.target.value)}
              />
            </Field>

            <Field label="Extra guest charge">
              <Input
                type="number"
                min={0}
                value={form.extraGuestPrice}
                onChange={(event) => set("extraGuestPrice", event.target.value)}
              />
            </Field>

            <Field label="Per child">
              <Input
                type="number"
                min={0}
                value={form.childPrice}
                onChange={(event) => set("childPrice", event.target.value)}
              />
            </Field>

            <Field label="Discount %">
              <Input
                type="number"
                min={0}
                max={100}
                value={form.discountPercent}
                onChange={(event) => set("discountPercent", event.target.value)}
              />
            </Field>

            <Field label="Tax %">
              <Input
                type="number"
                min={0}
                max={100}
                value={form.taxPercent}
                onChange={(event) => set("taxPercent", event.target.value)}
              />
            </Field>

            <Field label="Service fee %">
              <Input
                type="number"
                min={0}
                max={100}
                value={form.serviceFeePercent}
                onChange={(event) => set("serviceFeePercent", event.target.value)}
              />
            </Field>
          </div>

          {/* seasonal rate windows */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Seasonal rate windows</p>
              <Button
                type="button"
                variant="secondary"
                onClick={addRate}
                className="!px-3 !py-1.5"
              >
                <FiPlus size={14} /> Add window
              </Button>
            </div>

            {form.rates.length === 0 ? (
              <p className="text-xs text-slate-500">
                No date windows. Add one to price a festival or high season differently.
              </p>
            ) : (
              <ul className="space-y-3">
                {form.rates.map((rate) => (
                  <li
                    key={rate.key}
                    className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-6"
                  >
                    <Input
                      value={rate.name}
                      onChange={(event) => updateRate(rate.key, { name: event.target.value })}
                      placeholder="Name"
                      className="sm:col-span-2"
                    />
                    <Input
                      type="date"
                      value={rate.startDate}
                      onChange={(event) => updateRate(rate.key, { startDate: event.target.value })}
                      aria-label="Start date"
                    />
                    <Input
                      type="date"
                      value={rate.endDate}
                      onChange={(event) => updateRate(rate.key, { endDate: event.target.value })}
                      aria-label="End date"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={rate.price}
                      onChange={(event) => updateRate(rate.key, { price: event.target.value })}
                      aria-label="Price"
                    />
                    <Input
                      type="number"
                      min={1}
                      value={rate.minStayNights}
                      onChange={(event) =>
                        updateRate(rate.key, { minStayNights: event.target.value })
                      }
                      placeholder="Min"
                      aria-label="Minimum stay"
                    />
                    <button
                      type="button"
                      onClick={() => removeRate(rate.key)}
                      aria-label="Remove window"
                      className="justify-self-start rounded-lg p-2 text-rose-500 transition-colors hover:bg-rose-50 sm:col-span-6"
                    >
                      <FiTrash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ------------------------ amenities ------------------------ */}
        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-700">Room amenities</p>
          <AmenityPicker
            catalog={catalog}
            value={form.amenities}
            onChange={(value) => set("amenities", value)}
            disabled={saving}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => set("isActive", event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          Active — active rooms appear in the listing and can take bookings
        </label>

        {errors.length > 0 && (
          <Alert tone="danger">
            <ul className="list-inside list-disc space-y-0.5">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </Alert>
        )}
      </form>
    </Modal>
  );
};

export default RoomEditorModal;
