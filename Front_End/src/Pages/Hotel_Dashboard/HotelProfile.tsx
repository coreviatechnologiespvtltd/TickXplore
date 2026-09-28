/**
 * Hotel dashboard — profile, photos and amenities.
 * ------------------------------------------------------------------
 * One screen for everything customers read about the property itself.
 * The backend accepts profile fields and amenities in a single PUT, so the
 * form saves atomically: a partial save can never leave the listing with new
 * amenities and a stale description.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { FiImage, FiSave, FiTrash2, FiUpload } from "react-icons/fi";
import {
  ACCOMMODATION_TYPES,
  apiErrorMessage,
  hotelApi,
  imageSrc,
  type AmenityEntry,
  type HotelAccount,
  type HotelContact,
} from "../../api/hotel";
import { useHotelDashboard } from "./context";
import {
  Alert,
  AmenityPicker,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "./ui";

/* ------------------------------------------------------------------ */
/* Limits mirrored from the backend so failures are caught client-side  */
/* ------------------------------------------------------------------ */

const MAX_IMAGES = 12;
const MAX_FILES_PER_UPLOAD = 6;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = "image/jpeg,image/png,image/webp,image/avif";

interface ProfileForm {
  hotelName: string;
  description: string;
  type: string;
  starRating: number;
  address: string;
  area: string;
  city: string;
  district: string;
  country: string;
  latitude: string;
  longitude: string;
  phone: string;
  alternatePhone: string;
  email: string;
  website: string;
  whatsapp: string;
}

const toForm = (hotel: HotelAccount): ProfileForm => ({
  hotelName: hotel.hotelName ?? "",
  description: hotel.description ?? "",
  type: hotel.type ?? "Hotel",
  starRating: hotel.starRating ?? 3,
  address: hotel.address ?? "",
  area: hotel.area ?? "",
  city: hotel.city ?? "",
  district: hotel.district ?? "",
  country: hotel.country ?? "Nepal",
  latitude: hotel.latitude != null ? String(hotel.latitude) : "",
  longitude: hotel.longitude != null ? String(hotel.longitude) : "",
  phone: hotel.contact?.phone ?? "",
  alternatePhone: hotel.contact?.alternatePhone ?? "",
  email: hotel.contact?.email ?? "",
  website: hotel.contact?.website ?? "",
  whatsapp: hotel.contact?.whatsapp ?? "",
});

const emptyContact = (form: ProfileForm): Partial<HotelContact> => ({
  phone: form.phone.trim(),
  alternatePhone: form.alternatePhone.trim(),
  email: form.email.trim(),
  website: form.website.trim(),
  whatsapp: form.whatsapp.trim(),
});

/* ------------------------------------------------------------------ */

const HotelProfile = () => {
  const { hotel, refresh } = useHotelDashboard();

  const [form, setForm] = useState<ProfileForm | null>(null);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<AmenityEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageBusyId, setImageBusyId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (hotel) {
      setForm(toForm(hotel));
      setAmenities(hotel.amenities ?? []);
    }
  }, [hotel]);

  useEffect(() => {
    hotelApi.amenities("hotel").then(setCatalog).catch(() => setCatalog([]));
  }, []);

  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  /* ------------------------------ save ------------------------------ */

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;

    if (form.hotelName.trim().length < 2) {
      toast.error("Hotel name must be at least 2 characters.");
      return;
    }
    if (form.description.trim().length < 20) {
      toast.error("Description must be at least 20 characters.");
      return;
    }

    setSaving(true);
    try {
      const latitude = form.latitude.trim() === "" ? null : Number(form.latitude);
      const longitude = form.longitude.trim() === "" ? null : Number(form.longitude);

      if (latitude !== null && (Number.isNaN(latitude) || latitude < -90 || latitude > 90)) {
        toast.error("Latitude must be between -90 and 90.");
        return;
      }
      if (longitude !== null && (Number.isNaN(longitude) || longitude < -180 || longitude > 180)) {
        toast.error("Longitude must be between -180 and 180.");
        return;
      }

      await hotelApi.updateProfile({
        hotelName: form.hotelName.trim(),
        description: form.description.trim(),
        type: form.type as (typeof ACCOMMODATION_TYPES)[number],
        starRating: Number(form.starRating),
        address: form.address.trim(),
        area: form.area.trim(),
        city: form.city.trim(),
        district: form.district.trim(),
        country: form.country.trim(),
        latitude,
        longitude,
        contact: emptyContact(form),
        amenities,
      });

      await refresh();
      toast.success("Hotel profile saved.");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not save the hotel profile."));
    } finally {
      setSaving(false);
    }
  };

  /* ----------------------------- images ----------------------------- */

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    if ((hotel?.images?.length ?? 0) + files.length > MAX_IMAGES) {
      toast.error(`A hotel can have at most ${MAX_IMAGES} images.`);
      return;
    }
    if (files.length > MAX_FILES_PER_UPLOAD) {
      toast.error(`Upload at most ${MAX_FILES_PER_UPLOAD} images at a time.`);
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

    setUploading(true);
    try {
      await hotelApi.uploadImages(files);
      await refresh();
      toast.success(`${files.length} image(s) uploaded.`);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not upload the images."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const setCover = async (imageId: string) => {
    setImageBusyId(imageId);
    try {
      await hotelApi.setCoverImage(imageId);
      await refresh();
      toast.success("Cover image updated.");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not update the cover image."));
    } finally {
      setImageBusyId(null);
    }
  };

  const removeImage = async (imageId: string) => {
    setImageBusyId(imageId);
    try {
      await hotelApi.deleteImage(imageId);
      await refresh();
      toast.success("Image removed.");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not remove the image."));
    } finally {
      setImageBusyId(null);
    }
  };

  /** Move an image one slot left/right, then persist the full new order. */
  const moveImage = async (index: number, direction: -1 | 1) => {
    const images = hotel?.images ?? [];
    const target = index + direction;
    if (target < 0 || target >= images.length) return;

    const order = images.map((image) => image._id);
    [order[index], order[target]] = [order[target], order[index]];

    setImageBusyId(images[index]._id);
    try {
      await hotelApi.reorderImages(order);
      await refresh();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not reorder the images."));
    } finally {
      setImageBusyId(null);
    }
  };

  /* ---------------------------- amenities ---------------------------- */

  const saveAmenities = async () => {
    setSaving(true);
    try {
      await hotelApi.setAmenities(amenities);
      await refresh();
      toast.success("Amenities saved.");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not save the amenities."));
    } finally {
      setSaving(false);
    }
  };

  const selectedLabels = useMemo(
    () =>
      amenities
        .map((key) => catalog.find((entry) => entry.key === key)?.label || key)
        .sort(),
    [amenities, catalog]
  );

  if (!hotel || !form) return null;

  const images = [...(hotel.images ?? [])].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile & photos"
        subtitle="This is what customers see on the public Stay page once your listing is approved."
      />

      <form onSubmit={handleSave} className="space-y-6">
        {/* -------------------------- basics -------------------------- */}
        <Card title="Property details">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="Hotel name" required>
              <Input
                value={form.hotelName}
                onChange={(event) => set("hotelName", event.target.value)}
                placeholder="e.g. Himalayan View Resort"
                maxLength={150}
              />
            </Field>

            <Field label="Property type">
              <Select
                value={form.type}
                onChange={(event) => set("type", event.target.value)}
              >
                {ACCOMMODATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Star rating" hint="5-star listings are verified by an admin.">
              <Select
                value={String(form.starRating)}
                onChange={(event) => set("starRating", Number(event.target.value))}
              >
                {[1, 2, 3, 4, 5].map((stars) => (
                  <option key={stars} value={stars}>
                    {stars} star{stars === 1 ? "" : "s"}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Country">
              <Input
                value={form.country}
                onChange={(event) => set("country", event.target.value)}
                maxLength={80}
              />
            </Field>
          </div>

          <div className="mt-5">
            <Field
              label="Description"
              required
              hint={`${form.description.trim().length} characters — at least 50 are needed to submit.`}
            >
              <Textarea
                value={form.description}
                onChange={(event) => set("description", event.target.value)}
                rows={6}
                maxLength={6000}
                placeholder="Describe the property, its surroundings and what makes a stay here worth it."
              />
            </Field>
          </div>
        </Card>

        {/* -------------------------- location -------------------------- */}
        <Card
          title="Location"
          description="Used for the map and for 'stays near me' search results."
        >
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="Street address" required className="md:col-span-2">
              <Input
                value={form.address}
                onChange={(event) => set("address", event.target.value)}
                maxLength={400}
                placeholder="e.g. Ward No. 4, Lakeside"
              />
            </Field>

            <Field label="Area / tole">
              <Input
                value={form.area}
                onChange={(event) => set("area", event.target.value)}
                maxLength={150}
              />
            </Field>

            <Field label="City" required>
              <Input
                value={form.city}
                onChange={(event) => set("city", event.target.value)}
                maxLength={100}
                placeholder="e.g. Pokhara"
              />
            </Field>

            <Field label="District">
              <Input
                value={form.district}
                onChange={(event) => set("district", event.target.value)}
                maxLength={100}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Latitude" hint="-90 to 90">
                <Input
                  value={form.latitude}
                  onChange={(event) => set("latitude", event.target.value)}
                  inputMode="decimal"
                  placeholder="28.2096"
                />
              </Field>
              <Field label="Longitude" hint="-180 to 180">
                <Input
                  value={form.longitude}
                  onChange={(event) => set("longitude", event.target.value)}
                  inputMode="decimal"
                  placeholder="83.9856"
                />
              </Field>
            </div>
          </div>
        </Card>

        {/* --------------------------- contact --------------------------- */}
        <Card title="Contact" description="At least one phone number or email is required to submit.">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="Phone">
              <Input
                value={form.phone}
                onChange={(event) => set("phone", event.target.value)}
                placeholder="+977-98XXXXXXXX"
              />
            </Field>

            <Field label="Alternate phone">
              <Input
                value={form.alternatePhone}
                onChange={(event) => set("alternatePhone", event.target.value)}
              />
            </Field>

            <Field label="WhatsApp">
              <Input
                value={form.whatsapp}
                onChange={(event) => set("whatsapp", event.target.value)}
              />
            </Field>

            <Field label="Public email" hint="Leave blank to use your login email.">
              <Input
                value={form.email}
                onChange={(event) => set("email", event.target.value)}
                type="email"
                placeholder="frontdesk@example.com"
              />
            </Field>

            <Field label="Website" className="md:col-span-2">
              <Input
                value={form.website}
                onChange={(event) => set("website", event.target.value)}
                placeholder="https://example.com"
              />
            </Field>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" busy={saving}>
            <FiSave size={16} /> Save profile
          </Button>
        </div>
      </form>

      {/* ----------------------------- photos ----------------------------- */}
      <Card
        title="Photos"
        description={`${images.length}/${MAX_IMAGES} uploaded. The first image is used as the cover until you pick another one.`}
        action={
          <>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED}
              multiple
              className="hidden"
              onChange={(event) => void handleUpload(event.target.files)}
            />
            <Button
              type="button"
              variant="secondary"
              busy={uploading}
              disabled={images.length >= MAX_IMAGES}
              onClick={() => fileRef.current?.click()}
            >
              <FiUpload size={16} /> Upload
            </Button>
          </>
        }
      >
        {images.length === 0 ? (
          <Alert tone="warning">
            A cover image is required before you can submit. Add at least one photo of the
            property.
          </Alert>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((image, index) => (
              <li
                key={image._id}
                className="overflow-hidden rounded-xl border border-slate-100 bg-white"
              >
                <div className="relative">
                  <img
                    src={imageSrc(image.url)}
                    alt={image.caption || `Hotel photo ${index + 1}`}
                    className="h-32 w-full object-cover"
                  />
                  {image.isCover && (
                    <span className="absolute left-2 top-2 rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      Cover
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-1 p-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void moveImage(index, -1)}
                      disabled={index === 0 || imageBusyId === image._id}
                      aria-label="Move earlier"
                      className="rounded-md px-1.5 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-30"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => void moveImage(index, 1)}
                      disabled={index === images.length - 1 || imageBusyId === image._id}
                      aria-label="Move later"
                      className="rounded-md px-1.5 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-30"
                    >
                      →
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    {!image.isCover && (
                      <button
                        type="button"
                        onClick={() => void setCover(image._id)}
                        disabled={imageBusyId === image._id}
                        title="Set as cover"
                        className="rounded-md p-1.5 text-teal-600 transition-colors hover:bg-teal-50 disabled:opacity-40"
                      >
                        <FiImage size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void removeImage(image._id)}
                      disabled={imageBusyId === image._id}
                      title="Delete"
                      className="rounded-md p-1.5 text-rose-500 transition-colors hover:bg-rose-50 disabled:opacity-40"
                    >
                      <FiTrash2 size={15} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------------------- amenities ---------------------------- */}
      <Card
        title="Hotel amenities"
        description="Customers filter the Stay page on these, so pick everything the property genuinely offers."
        action={
          <Button type="button" busy={saving} onClick={() => void saveAmenities()}>
            Save amenities
          </Button>
        }
      >
        {selectedLabels.length > 0 && (
          <p className="mb-4 text-sm text-slate-500">
            <span className="font-semibold text-slate-700">{selectedLabels.length}</span> selected:{" "}
            {selectedLabels.join(", ")}
          </p>
        )}
        <AmenityPicker
          catalog={catalog}
          value={amenities}
          onChange={setAmenities}
          disabled={saving}
        />
      </Card>
    </div>
  );
};

export default HotelProfile;
