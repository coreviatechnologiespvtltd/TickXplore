/** Shared domain types matching the backend API contract. */

export type Role = "user" | "vendor" | "hotel" | "admin";

export interface User {
  _id: string;
  name: string;
  email: string;
  phoneNumber?: string;
  location?: string;
  role: Role;
  profilePhoto?: string;
  isActive?: boolean;
  vendorStatus?: "none" | "pending" | "declined" | "active";
}

export interface Vendor extends User {
  vendorName?: string;
  vendorLocation?: string;
  applicationStatus?: "pending" | "approved" | "declined";
  applicationReason?: string;
  createdAt?: string;
}

export interface Bus {
  _id: string;
  name?: string;
  busName?: string;
  pickupPoint: string;
  dropPoint: string;
  pricePerSeat: number;
  totalSeats: number;
  bookedSeats?: number[];
  takeOffDate?: string;
  tripDate?: string;
  date?: string;
  status?: string;
  departureTime?: string;
  image?: string;
  isActive?: boolean;
  vendorId?: string;
}

export interface Vehicle {
  _id: string;
  name: string;
  type?: string;
  pickupPoint?: string;
  dropPoint?: string;
  price: number;
  totalSeats?: number;
  capacity?: number;
  isAvailable?: boolean;
  totalEarnings?: number;
  totalCommission?: number;
  takeOffDate?: string;
  image?: string;
  vendorId?: string;
  reservations?: {
    reservedFrom?: string;
    reservedUntil?: string;
  }[];
}

export type BookingStatus = "Booked" | "Pending" | "Cancelled";

export interface BookingRef {
  _id?: string;
  name?: string;
  pickupPoint?: string;
  dropPoint?: string;
  departureTime?: string;
}

export interface Passenger {
  name?: string;
  phone?: string;
}

export interface Booking {
  _id: string;
  bookingId?: string;
  busId?: string | BookingRef;
  vehicleId?: string | BookingRef;
  userId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  bookingNumber?: string;
  emailStatus?: "Sent" | "Pending" | "Failed" | "None" | string;
  emailSentAt?: string;
  emailError?: string;
  passengers?: Passenger[];
  seats?: number[];
  selectedSeats?: Array<number | string>;
  totalPrice?: number;
  commissionAmount?: number;
  vendorEarnings?: number;
  status: BookingStatus | string;
  takeOffDate?: string;
  reservationDate?: string;
  createdAt?: string;
  date?: string;
  pickupPoint?: string;
  dropPoint?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  user?: { name?: string; email?: string };
  bus?: BookingRef;
  vehicle?: BookingRef;
}

export interface RefundRequest {
  _id: string;
  bookingId?: string | BookingRef;
  userId?: string | User;
  refundAmount?: number;
  reason?: string;
  status?: string;
}

export interface Notification {
  _id: string;
  role?: Role;
  userId?: string;
  message: string;
  isRead: boolean;
  createdAt?: string;
}

export interface TouristArea {
  _id: string;
  title: string;
  description: string;
  image: string;
  rating: number;
  price?: string | number;
  pickupPoint?: string;
  dropPoint?: string;
}

export interface DashboardStats {
  users?: User[];
  vendors?: Vendor[];
  admins?: User[];
  buses?: Bus[];
  vehicles?: Vehicle[];
  bookings?: Booking[];
  refundRequests?: RefundRequest[];
}

export interface HomepageContent {
  backgroundImage?: string;
  title?: string;
}