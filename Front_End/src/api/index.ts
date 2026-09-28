/** Typed API services grouped by domain. All calls go through the shared client. */
import api from "./http";
import type {
  Booking,
  BookingCreateResponse,
  Bus,
  DashboardStats,
  HomepageContent,
  Notification,
  RefundRequest,
  TouristArea,
  User,
  Vehicle,
  Vendor,
} from "./types";
import { ACCOMMODATION_TYPES } from "./hotel";

export { default as api } from "./http";
export { API_BASE_URL, LOGIN_PATH } from "./http";
export * from "./types";
export * from "./hotel";

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */
export const authApi = {
  signIn: (data: { email: string; password: string }) =>
    api.post("/auth/sign-in", data).then((r) => r.data),

  googleSignIn: (idToken: string) =>
    api.post("/auth/google-signin", { idToken }).then((r) => r.data),

  forgotPassword: (role: string, email: string) =>
    api.post(`/auth/forgot-password/${role}`, { email }).then((r) => r.data),

  verifyResetOtp: (data: { email: string; otp: string; role: string }) =>
    api.post("/auth/verify-reset-otp", data).then((r) => r.data),

  resetPassword: (data: { email: string; newPassword: string; role: string }) =>
    api.post("/auth/reset-password", data).then((r) => r.data),

  changePassword: (
    role: string,
    data: { currentPassword: string; newPassword: string; confirmPassword: string }
  ) => api.post(`/auth/change-password/${role}`, data).then((r) => r.data),
};

/* ------------------------------------------------------------------ */
/* Users / registration                                                */
/* ------------------------------------------------------------------ */

/**
 * Body accepted by `POST /auth/register`.
 *
 * `vendor*` is required when `role` is `"vendor"`, `hotel*` when it is
 * `"hotel"`. The hotel listing seed (`type` … `amenities`) is optional and is
 * only read by the backend for `role: "hotel"`; the rest of the listing is
 * completed later in the hotel dashboard.
 */
export interface RegisterPayload {
  role: "user" | "vendor" | "hotel";
  name: string;
  location: string;
  email: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;

  vendorName?: string;
  vendorLocation?: string;

  hotelName?: string;
  hotelLocation?: string;

  /* Hotel listing seed — optional */
  type?: (typeof ACCOMMODATION_TYPES)[number];
  starRating?: number;
  description?: string;
  address?: string;
  area?: string;
  city?: string;
  district?: string;
  latitude?: number | null;
  longitude?: number | null;
  amenities?: string[];
}

export interface RegisterResponse {
  message: string;
  user: { _id: string; email: string; role: string };
}

export const usersApi = {
  /**
   * NOTE: the backend exposes this at `/auth/register`. The old `/users/register`
   * path matched no route and always 404'd — `userRoutes` declares no `POST`
   * handler, so the request fell through to the app-wide 404.
   */
  register: (data: RegisterPayload) =>
    api.post("/auth/register", data).then((r) => r.data as RegisterResponse),

  verifyOtp: (data: { userId: string; otp: string }) =>
    api.post("/api/verify-otp", data).then((r) => r.data),

  resendOtp: (data: { userId: string; email: string }) =>
    api.post("/api/resend-otp", data).then((r) => r.data),

  updateLocation: (userId: string, location: { latitude: number; longitude: number }) =>
    api.put(`/api/users/${userId}/location`, location).then((r) => r.data),

  applyVendor: (
    userId: string,
    payload: {
      vendorName: string;
      vendorLocation: string;
      phoneNumber?: string;
      applicationReason: string;
    }
  ) =>
    api.put(`/api/users/${userId}/become-vendor`, payload).then((r) => r.data),

  getById: (id: string): Promise<{ user?: User; admin?: User; vendor?: Vendor }> => {
    const role = localStorage.getItem("userRole");
    const endpoint =
      role === "admin" ? "admin" : role === "vendor" ? "vendor" : "users";
    return api.get(`/${endpoint}/${id}`).then((r) => r.data);
  },

  endpointFor: (role: string): string =>
    role === "user" ? "users" : role,

  updateProfile: (role: string, id: string, formData: FormData): Promise<{ user?: User; admin?: User; vendor?: Vendor }> =>
    api.put(`/${role === "user" ? "users" : role}/${id}`, formData).then((r) => r.data),

  deleteAccount: (role: string, id: string) =>
    api.delete(`/${role === "user" ? "users" : role}/${id}`).then((r) => r.data),
};

/* ------------------------------------------------------------------ */
/* Home + catalog                                                      */
/* ------------------------------------------------------------------ */
export const homeApi = {
  getContent: (): Promise<HomepageContent> =>
    api.get("/api/homepage").then((r) => r.data),

  getBuses: (params?: Record<string, unknown>): Promise<{ buses: Bus[]; data?: Bus[] }> =>
    api.get("/api/buses", { params }).then((r) => r.data),

  getVehicles: (params?: Record<string, unknown>): Promise<{ vehicles: Vehicle[]; data?: Vehicle[] }> =>
    api.get("/api/vehicles", { params }).then((r) => r.data),

  getBusById: (id: string): Promise<{ bus: Bus }> =>
    api.get(`/api/buses/${id}`).then((r) => r.data),

  getVehicleById: (id: string): Promise<{ vehicle: Vehicle }> =>
    api.get(`/api/vehicles/${id}`).then((r) => r.data),

  getTouristAreas: (): Promise<TouristArea[]> =>
    api.get("/api/tourist-areas").then((r) => r.data),
};

/* ------------------------------------------------------------------ */
/* Buses / vehicles full CRUD (vendor + admin)                         */
/* ------------------------------------------------------------------ */
type TransportPayload = Record<string, unknown> | FormData;

export const busesApi = {
  create: (payload: TransportPayload) =>
    api.post("/api/buses", payload).then((r) => r.data),

  update: (id: string, payload: TransportPayload) =>
    api.put(`/api/buses/${id}`, payload).then((r) => r.data),

  remove: (id: string) => api.delete(`/api/buses/${id}`).then((r) => r.data),
};

export const vehiclesApi = {
  create: (payload: TransportPayload) =>
    api.post("/api/vehicles", payload).then((r) => r.data),

  update: (id: string, payload: TransportPayload) =>
    api.put(`/api/vehicles/${id}`, payload).then((r) => r.data),

  remove: (id: string) => api.delete(`/api/vehicles/${id}`).then((r) => r.data),
};

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */
export const notificationsApi = {
  get: (role: string, userId: string): Promise<{ data: Notification[] }> =>
    api.get(`/api/notifications/${role}/${userId}`).then((r) => r.data),

  markRead: (id: string) =>
    api.put(`/api/notifications/${id}/read`).then((r) => r.data),
};

/* ------------------------------------------------------------------ */
/* Bookings + payments                                                 */
/* ------------------------------------------------------------------ */
export const bookingsApi = {
  getUserBookings: (userId: string): Promise<{ bookings: Booking[] }> =>
    api.get(`/api/refunds/my-bookings/${userId}`).then((r) => r.data),

  deleteBooking: (id: string) => api.delete(`/api/bookings/${id}`).then((r) => r.data),

  confirmBooking: (id: string) => api.put(`/api/bookings/confirm/${id}`).then((r) => r.data),

  cancel: (id: string, payload?: Record<string, unknown>) =>
    api.post(`/api/bookings/${id}/cancel`, payload).then((r) => r.data),

  refundRequest: (bookingId: string, payload?: Record<string, unknown>) =>
    api.post(`/api/bookings/refund-request/${bookingId}`, payload).then((r) => r.data),

  getCovSeats: (busId: string): Promise<{ covSeats: number[] }> =>
    api.get(`/api/payments/cov-seats/${busId}`).then((r) => r.data),

  initiatePayment: (payload: Record<string, unknown>): Promise<BookingCreateResponse> =>
    api.post("/api/payments/initiate", payload).then((r) => r.data),

  verifyPayment: (payload: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; message?: string }> =>
    api.post("/api/payments/verify", payload).then((r) => r.data),

  cashOnVisit: (payload: Record<string, unknown>): Promise<BookingCreateResponse> =>
    api.post("/api/payments/cash-on-visit", payload).then((r) => r.data),

  sendTicket: (bookingId: string): Promise<{ message: string; emailStatus?: string; bookingNumber?: string }> =>
    api.post("/api/payments/resend-ticket", { bookingId }).then((r) => r.data),

  getReservationsByVehicle: (vehicleId: string): Promise<unknown[]> =>
    api.get(`/api/reservations/vehicle/${vehicleId}`).then((r) => r.data),

  getReservationsByVendor: (vendorId: string): Promise<unknown[]> =>
    api.get(`/api/reservations/vendor/${vendorId}`).then((r) => r.data),
};

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */
export const refundsApi = {
  getUserHistory: (userId: string): Promise<{ bookings: Booking[] }> =>
    api.get(`/api/refunds/my-bookings/${userId}`).then((r) => r.data),

  /** Soft-cancel a booking (frees bus seats) for the user. */
  cancel: (bookingId: string) =>
    api.put(`/api/refunds/cancel/${bookingId}`).then((r) => r.data),

  /** Returns a raw array of upcoming/refundable bookings for the user. */
  getUpcoming: (userId: string): Promise<Booking[]> =>
    api.get(`/api/refunds/upcoming/${userId}`).then((r) => r.data),

  /** Returns a raw array of refund history entries for the user. */
  getHistory: (userId: string): Promise<unknown[]> =>
    api.get(`/api/refunds/history/${userId}`).then((r) => r.data),

  request: (payload: Record<string, unknown>) =>
    api.post("/api/refunds/request", payload).then((r) => r.data),

  requestByBookingId: (bookingId: string, reason: string) =>
    api.post(`/api/refunds/request/${bookingId}`, { reason }).then((r) => r.data),

  adminAction: (id: string, action: "approve" | "reject") =>
    api.put(`/api/refunds/admin/refund-requests/${id}`, { action }).then((r) => r.data),
};

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */
export const adminApi = {
  getDashboard: async (): Promise<DashboardStats> => {
    const [usersRes, vendorsRes, adminsRes, busesRes, vehiclesRes, bookingsRes, refundRes] =
      await Promise.all([
        api.get("/admin/dashboard/get-users"),
        api.get("/admin/dashboard/get-vendors"),
        api.get("/admin/dashboard/get-admins"),
        api.get("/api/buses?admin=true"),
        api.get("/api/vehicles?admin=true"),
        api.get("/admin/bookings"),
        api.get("/api/refunds/admin/refund-requests"),
      ]);

    const buses = busesRes.data.buses ?? busesRes.data.data ?? [];
    const vehicles = vehiclesRes.data.vehicles ?? vehiclesRes.data.data ?? [];

    return {
      users: usersRes.data.users || [],
      vendors: vendorsRes.data.vendors || [],
      admins: adminsRes.data.admins || [],
      buses,
      vehicles,
      bookings: bookingsRes.data.bookings || [],
      refundRequests: refundRes.data || [],
    };
  },

  /** Partial re-fetch of a single resource used after mutations. */
  getRefundRequests: (): Promise<RefundRequest[]> =>
    api.get("/api/refunds/admin/refund-requests").then((r) => r.data),

  toggleVendor: (vendorId: string) =>
    api.put(`/admin/toggle-vendor/${vendorId}`).then((r) => r.data),

  approveVendor: (vendorId: string) =>
    api.put(`/admin/vendor/${vendorId}/approve`).then((r) => r.data),

  declineVendor: (vendorId: string) =>
    api.put(`/admin/vendor/${vendorId}/decline`).then((r) => r.data),

  deleteUser: (userId: string) =>
    api.delete(`/admin/delete-user/${userId}`).then((r) => r.data),

  deleteVendor: (vendorId: string) =>
    api.delete(`/admin/delete-vendor/${vendorId}`).then((r) => r.data),

  deleteAdmin: (adminId: string) =>
    api.delete(`/admin/${adminId}`).then((r) => r.data),
};

/* ------------------------------------------------------------------ */
/* Vendor                                                              */
/* ------------------------------------------------------------------ */
export const vendorApi = {
  getDashboard: async (vendorId: string): Promise<{ vehicles: Vehicle[]; buses: Bus[]; bookings: Booking[] }> => {
    const [vehicles, buses, bookings] = await Promise.all([
      api
        .get<{ vehicles?: Vehicle[] }>(`/api/vehicles?vendorId=${vendorId}`)
        .then((r) => r.data.vehicles || [])
        .catch(() => [] as Vehicle[]),
      api
        .get<{ buses?: Bus[] }>(`/api/buses?vendorId=${vendorId}`)
        .then((r) => r.data.buses || [])
        .catch(() => [] as Bus[]),
      api
        .get<{ bookings?: Booking[] }>(`/api/bookings?vendorId=${vendorId}`)
        .then((r) => r.data.bookings || [])
        .catch(() => [] as Booking[]),
    ]);
    return { vehicles, buses, bookings };
  },
};