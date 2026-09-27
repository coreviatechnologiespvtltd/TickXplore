/**
 * Hotel dashboard API — types + client for the hotel backend.
 * ------------------------------------------------------------------
 * Mirrors `Back_End/routes/hotelRoutes.js` (mounted at `/api/hotel`) and the
 * public amenity catalog at `/api/hotels/amenities`.
 *
 * Every dashboard response is `{ success: true, ... }`; failures come back as
 * `{ success: false, message, details? }` and are surfaced by `apiErrorMessage`.
 */
import api, { API_BASE_URL } from "./http";

/* ------------------------------------------------------------------ */
/* Enumerations (kept in sync with the backend model exports)           */
/* ------------------------------------------------------------------ */

export const LISTING_STATUSES = [
  "draft",
  "pending_approval",
  "published",
  "rejected",
  "suspended",
  "archived",
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const ACCOMMODATION_TYPES = [
  "Hotel",
  "Villa",
  "Apartment",
  "Guest House",
  "Private Room",
  "Resort",
  "Lodge",
  "Homestay",
] as const;
export type AccommodationType = (typeof ACCOMMODATION_TYPES)[number];

export const ROOM_CATEGORIES = [
  "Standard",
  "Deluxe",
  "Superior",
  "Executive",
  "Suite",
  "Family Suite",
  "Studio",
  "Villa",
  "Bungalow",
  "Dormitory",
] as const;
export type RoomCategory = (typeof ROOM_CATEGORIES)[number];

export const BED_TYPES = [
  "king",
  "queen",
  "double",
  "twin",
  "single",
  "bunk",
  "sofa",
  "cot",
  "crib",
] as const;
export type BedType = (typeof BED_TYPES)[number];

/* ------------------------------------------------------------------ */
/* Domain types                                                         */
/* ------------------------------------------------------------------ */

export interface AmenityEntry {
  key: string;
  label: string;
  category: string;
  icon?: string;
  scope: ("hotel" | "room")[];
}

export interface AmenityCatalog {
  amenities: AmenityEntry[];
  byCategory: Record<string, AmenityEntry[]>;
  count: number;
}

export interface HotelImage {
  _id: string;
  url: string;
  caption: string;
  order: number;
  isCover: boolean;
}

export interface CancellationTier {
  daysBeforeCheckIn: number;
  refundPercent: number;
  label?: string;
}

export interface CancellationPolicy {
  freeCancellationDays: number;
  nonRefundableAfterDays: number;
  tiers: CancellationTier[];
  notes: string;
}

export interface HotelPolicies {
  checkInTime: string;
  checkOutTime: string;
  minStayNights: number;
  maxStayNights: number;
  cancellationPolicy: CancellationPolicy;
  houseRules: string[];
  childrenPolicy: string;
  petPolicy: string;
}

export interface HotelContact {
  phone: string;
  alternatePhone: string;
  email: string;
  website: string;
  whatsapp: string;
}

export interface StatusHistoryEntry {
  _id: string;
  from: ListingStatus | null;
  to: ListingStatus;
  reason: string;
  by?: string;
  at: string;
}

export interface HotelStatusMeta {
  submittedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  publishedAt?: string;
  suspendedAt?: string;
  suspendedReason?: string;
  archivedAt?: string;
}

export interface RatingSummary {
  average: number;
  count: number;
}

/** The authenticated hotel: account identity + listing content. */
export interface HotelAccount {
  _id: string;
  hotelId: string;
  hotelName: string;
  hotelLocation: string;
  email: string;
  phoneNumber?: string;
  isActive: boolean;
  applicationStatus: "pending" | "approved" | "declined";
  description: string;
  type: AccommodationType;
  starRating: number;
  contact: HotelContact;
  address: string;
  area: string;
  city: string;
  district: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  amenities: string[];
  images: HotelImage[];
  coverImage: string;
  policies: HotelPolicies;
  listingStatus: ListingStatus;
  statusMeta: HotelStatusMeta;
  statusHistory: StatusHistoryEntry[];
  ratingSummary: RatingSummary;
  totalEarnings: number;
  totalCommission: number;
  createdAt?: string;
}

export interface ProfileSummary {
  listingStatus: ListingStatus;
  roomCount: number;
  activeRoomCount: number;
  totalInventory: number;
  hasUnpublishedChanges: boolean;
  publishedVersion: number;
}

export interface ProfileResponse {
  hotel: HotelAccount;
  summary: ProfileSummary;
}

export interface SeasonalRate {
  _id?: string;
  name: string;
  startDate: string;
  endDate: string;
  price: number;
  minStayNights: number | null;
}

export interface RoomPricing {
  currency: string;
  basePrice: number;
  weekendPrice: number | null;
  seasonalPrice: number | null;
  seasonalRates: SeasonalRate[];
  extraGuestPrice: number;
  childPrice: number;
  discountPercent: number;
  discountAmount: number;
  taxPercent: number;
  serviceFeePercent: number;
}

export interface BedEntry {
  type: BedType;
  count: number;
}

export interface HotelRoom {
  _id: string;
  name: string;
  description: string;
  type: RoomCategory;
  totalRooms: number;
  maxGuests: number;
  maxAdults: number | null;
  maxChildren: number;
  bedrooms: number;
  bathrooms: number;
  attachedBathrooms: number;
  sizeSqm: number | null;
  beds: BedEntry[];
  bedCount: number;
  pricing: RoomPricing;
  amenities: string[];
  images: HotelImage[];
  coverImage: string;
  isActive: boolean;
  isArchived: boolean;
  archivedAt?: string;
  ratingSummary: RatingSummary;
  totalEarnings: number;
  totalCommission: number;
  createdAt?: string;
}

export interface AvailabilityOverride {
  roomTypeId?: string;
  date: string;
  availableCount: number | null;
  bookedCount: number;
  status: "available" | "blocked" | "booked" | string;
  priceOverride: number | null;
  minStayOverride: number | null;
  note?: string;
}

export interface AvailabilityBlock {
  _id: string;
  roomTypeId: string | null;
  scope: "hotel" | "room";
  roomName?: string | null;
  startDate: string;
  endDate: string;
  reason: string;
  isActive: boolean;
  source?: string;
  createdAt?: string;
}

export interface CalendarNight {
  date: string;
  available: number;
  total: number;
  isHotelBlocked: boolean;
  soldOutRoomTypes: number;
}

export interface CalendarRoomSummary {
  roomTypeId: string;
  name: string;
  totalRooms: number;
  isAvailable: boolean;
  minAvailable: number;
}

export interface CalendarResponse {
  range: { from: string; to: string; nightCount: number };
  policy: {
    checkInTime: string;
    checkOutTime: string;
    minStayNights: number;
    maxStayNights: number;
  };
  hotel: CalendarRoomSummary[];
  calendar: CalendarNight[];
  blocks: AvailabilityBlock[];
  overrides: AvailabilityOverride[];
}

export interface RoomAvailabilityResponse {
  room: { _id: string; name: string; totalRooms: number };
  availability: {
    roomTypeId: string;
    name: string;
    totalRooms: number;
    isAvailable: boolean;
    minAvailable: number;
    nights: Array<{
      date: string;
      availableCount: number;
      isHotelBlocked: boolean;
      isRoomBlocked: boolean;
      isSoldOut: boolean;
      minStay: number;
      price: number;
    }>;
  } | null;
  blocks: AvailabilityBlock[];
  overrides: AvailabilityOverride[];
}

export interface HotelStats {
  listingStatus: ListingStatus;
  isAccountActive: boolean;
  roomCount: number;
  activeRooms: number;
  archivedRooms: number;
  totalInventory: number;
  blockedNights: number;
  overrideNights: number;
  soldOutNights: number;
  availableNow: number;
  totalEarnings: number;
  totalCommission: number;
  publishedVersion: number;
  hasUnpublishedChanges: boolean;
}

/** One readiness blocker / warning from `GET /listing/readiness`. */
export interface ReadinessIssue {
  field: string;
  message: string;
  roomId?: string;
}

export interface ReadinessReport {
  ready: boolean;
  blockers: ReadinessIssue[];
  warnings: ReadinessIssue[];
  roomCount: number;
}

export interface ListingStatusResponse {
  listingStatus: ListingStatus;
  statusMeta: HotelStatusMeta;
  statusHistory: StatusHistoryEntry[];
  publishedVersion: number;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
  rejectionReason: string;
  allowedActions: {
    canSubmit: boolean;
    canWithdraw: boolean;
    canArchive: boolean;
    canRestore: boolean;
  };
}

/** Amenity scope for a picker: `"hotel"` or `"room"`. */
export type AmenityScope = "hotel" | "room";

/* ------------------------------------------------------------------ */
/* Payload shapes                                                       */
/* ------------------------------------------------------------------ */

export interface ProfilePayload {
  hotelName?: string;
  description?: string;
  type?: AccommodationType;
  starRating?: number;
  address?: string;
  area?: string;
  city?: string;
  district?: string;
  country?: string;
  hotelLocation?: string;
  latitude?: number | null;
  longitude?: number | null;
  contact?: Partial<HotelContact>;
  amenities?: string[];
}

export interface PoliciesPayload {
  checkInTime?: string;
  checkOutTime?: string;
  minStayNights?: number;
  maxStayNights?: number;
  cancellationPolicy?: {
    freeCancellationDays?: number;
    nonRefundableAfterDays?: number;
    notes?: string;
    tiers?: CancellationTier[];
  };
  houseRules?: string[];
  childrenPolicy?: string;
  petPolicy?: string;
}

export interface RoomPayload {
  name?: string;
  description?: string;
  type?: RoomCategory;
  totalRooms?: number;
  maxGuests?: number;
  maxAdults?: number | null;
  maxChildren?: number;
  bedrooms?: number;
  bathrooms?: number;
  attachedBathrooms?: number;
  sizeSqm?: number | null;
  beds?: BedEntry[];
  isActive?: boolean;
  amenities?: string[];
  pricing?: Partial<RoomPricing> & { seasonalRates?: Partial<SeasonalRate>[] };
}

export interface AvailabilityPayload {
  availableCount?: number;
  priceOverride?: number;
  minStayOverride?: number;
  note?: string;
}

export interface BlockPayload {
  startDate: string;
  endDate: string;
  reason?: string;
  roomTypeId?: string | null;
}

export interface RoomNotification {
  _id: string;
  title?: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  type?: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** `Date` -> `YYYY-MM-DD` in UTC, matching the backend's `toDateKey`. */
export const toDateKey = (date: Date): string => date.toISOString().slice(0, 10);

/** `YYYY-MM-DD` -> `Date` at UTC midnight. */
export const fromDateKey = (key: string): Date => new Date(`${key}T00:00:00.000Z`);

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 86400000);

/** Resolve a stored `/uploads/...` path against the API origin. */
export const imageSrc = (path?: string | null): string =>
  !path ? "" : path.startsWith("http") ? path : `${API_BASE_URL}${path}`;

/** Pull a human-readable message out of an axios error from the hotel API. */
export const apiErrorMessage = (
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string => {
  const maybe = error as {
    response?: { data?: { message?: string; details?: unknown } };
    message?: string;
  };
  return (
    maybe?.response?.data?.message ||
    maybe?.message ||
    fallback
  );
};

/* ------------------------------------------------------------------ */
/* Client                                                               */
/* ------------------------------------------------------------------ */

const BASE = "/api/hotel";

/** The catalog is static, so it is fetched once per page load. */
let catalogPromise: Promise<AmenityCatalog> | null = null;

export const hotelApi = {
  /* ------------------------- profile + stats ------------------------- */
  getProfile: (): Promise<ProfileResponse> =>
    api.get(`${BASE}/profile`).then((r) => r.data),

  updateProfile: (payload: ProfilePayload): Promise<{ message: string; hotel: HotelAccount }> =>
    api.put(`${BASE}/profile`, payload).then((r) => r.data),

  getStats: (): Promise<{ stats: HotelStats }> =>
    api.get(`${BASE}/stats`).then((r) => r.data),

  /* ----------------------------- images ----------------------------- */
  uploadImages: (files: FileList | File[], setAsCover = false) => {
    const form = new FormData();
    Array.from(files).forEach((file) => form.append("images", file));
    form.append("setCover", setAsCover ? "true" : "false");
    return api.post(`${BASE}/profile/images`, form).then((r) => r.data);
  },

  setCoverImage: (imageId: string) =>
    api.put(`${BASE}/profile/cover`, { imageId }).then((r) => r.data),

  reorderImages: (order: string[]) =>
    api.put(`${BASE}/profile/images/reorder`, { order }).then((r) => r.data),

  deleteImage: (imageId: string) =>
    api.delete(`${BASE}/profile/images/${imageId}`).then((r) => r.data),

  /* ---------------------------- amenities ---------------------------- */
  setAmenities: (amenities: string[]) =>
    api.put(`${BASE}/profile/amenities`, { amenities }).then((r) => r.data),

  /** Public catalog, memoised for the lifetime of the tab. */
  amenities: (scope?: AmenityScope): Promise<AmenityEntry[]> => {
    if (!catalogPromise) {
      catalogPromise = api
        .get("/api/hotels/amenities")
        .then((r) => r.data as AmenityCatalog)
        .catch(() => ({ amenities: [], byCategory: {}, count: 0 }));
    }
    return catalogPromise.then((catalog) =>
      scope ? catalog.amenities.filter((a) => a.scope?.includes(scope)) : catalog.amenities
    );
  },

  /* ---------------------------- policies ---------------------------- */
  updatePolicies: (payload: PoliciesPayload): Promise<{ message: string; policies: HotelPolicies }> =>
    api.put(`${BASE}/policies`, payload).then((r) => r.data),

  /* ------------------------- listing lifecycle ------------------------- */
  getListingStatus: (): Promise<ListingStatusResponse> =>
    api.get(`${BASE}/listing/status`).then((r) => r.data),

  getReadiness: (): Promise<ReadinessReport & { listingStatus: ListingStatus }> =>
    api.get(`${BASE}/listing/readiness`).then((r) => r.data),

  submitListing: (reason?: string) =>
    api.post(`${BASE}/listing/submit`, { reason }).then((r) => r.data),

  withdrawListing: (reason?: string) =>
    api.post(`${BASE}/listing/withdraw`, { reason }).then((r) => r.data),

  archiveListing: (reason?: string) =>
    api.post(`${BASE}/listing/archive`, { reason }).then((r) => r.data),

  restoreListing: () =>
    api.post(`${BASE}/listing/restore`, {}).then((r) => r.data),

  /* ------------------------------ rooms ------------------------------ */
  getRooms: (params?: {
    includeArchived?: boolean;
    isActive?: boolean;
    search?: string;
  }): Promise<{ rooms: HotelRoom[]; count: number }> =>
    api.get(`${BASE}/rooms`, { params }).then((r) => r.data),

  getRoom: (roomId: string): Promise<{ room: HotelRoom }> =>
    api.get(`${BASE}/rooms/${roomId}`).then((r) => r.data),

  createRoom: (payload: RoomPayload) =>
    api.post(`${BASE}/rooms`, payload).then((r) => r.data),

  updateRoom: (roomId: string, payload: RoomPayload) =>
    api.put(`${BASE}/rooms/${roomId}`, payload).then((r) => r.data),

  deleteRoom: (roomId: string, force = false) =>
    api.delete(`${BASE}/rooms/${roomId}`, { params: { force } }).then((r) => r.data),

  restoreRoom: (roomId: string, isActive = true) =>
    api.post(`${BASE}/rooms/${roomId}/restore`, { isActive }).then((r) => r.data),

  updateRoomPricing: (roomId: string, pricing: Partial<RoomPricing>) =>
    api.put(`${BASE}/rooms/${roomId}/pricing`, pricing).then((r) => r.data),

  setRoomAmenities: (roomId: string, amenities: string[]) =>
    api.put(`${BASE}/rooms/${roomId}/amenities`, { amenities }).then((r) => r.data),

  /* ----------------------------- images ----------------------------- */
  uploadRoomImages: (roomId: string, files: FileList | File[]) => {
    const form = new FormData();
    Array.from(files).forEach((file) => form.append("images", file));
    return api.post(`${BASE}/rooms/${roomId}/images`, form).then((r) => r.data);
  },

  deleteRoomImage: (roomId: string, imageId: string) =>
    api.delete(`${BASE}/rooms/${roomId}/images/${imageId}`).then((r) => r.data),

  setRoomCover: (roomId: string, imageId: string) =>
    api.put(`${BASE}/rooms/${roomId}/images/${imageId}/cover`, {}).then((r) => r.data),

  /* --------------------------- availability --------------------------- */
  getRoomAvailability: (
    roomId: string,
    from: string,
    to: string
  ): Promise<RoomAvailabilityResponse> =>
    api
      .get(`${BASE}/rooms/${roomId}/availability`, { params: { from, to } })
      .then((r) => r.data),

  setRoomAvailability: (
    roomId: string,
    from: string,
    to: string,
    payload: AvailabilityPayload
  ) =>
    api
      .put(`${BASE}/rooms/${roomId}/availability`, payload, { params: { from, to } })
      .then((r) => r.data),

  clearRoomAvailability: (roomId: string, from: string, to: string) =>
    api
      .delete(`${BASE}/rooms/${roomId}/availability`, { params: { from, to } })
      .then((r) => r.data),

  getCalendar: (from: string, to: string): Promise<CalendarResponse> =>
    api.get(`${BASE}/availability/calendar`, { params: { from, to } }).then((r) => r.data),

  /* ------------------------------ blocks ------------------------------ */
  getBlocks: (isActive?: boolean): Promise<{ blocks: AvailabilityBlock[] }> =>
    api.get(`${BASE}/availability/blocks`, { params: { isActive } }).then((r) => r.data),

  createBlock: (payload: BlockPayload) =>
    api.post(`${BASE}/availability/blocks`, payload).then((r) => r.data),

  updateBlock: (blockId: string, payload: Partial<BlockPayload> & { isActive?: boolean }) =>
    api.put(`${BASE}/availability/blocks/${blockId}`, payload).then((r) => r.data),

  unblockBlock: (blockId: string) =>
    api.put(`${BASE}/availability/blocks/${blockId}/unblock`, {}).then((r) => r.data),

  deleteBlock: (blockId: string) =>
    api.delete(`${BASE}/availability/blocks/${blockId}`).then((r) => r.data),

  /* --------------------------- notifications --------------------------- */
  getNotifications: (): Promise<{ notifications: RoomNotification[] }> =>
    api.get(`${BASE}/notifications`).then((r) => r.data),

  markNotificationRead: (notificationId: string) =>
    api.put(`${BASE}/notifications/${notificationId}/read`, {}).then((r) => r.data),
};

export type HotelApi = typeof hotelApi;
