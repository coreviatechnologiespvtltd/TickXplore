import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  FaBus,
  FaMapMarkerAlt,
  FaTicketAlt,
  FaTag,
  FaCalendarAlt,
  FaChair,
  FaRegClock,
  FaQrcode,
  FaArrowRight,
} from "react-icons/fa";
import { ImSpinner8 } from "react-icons/im";
import { motion } from "framer-motion";
import { refundsApi, type Booking } from "../api";
import { bookingNumberOf, formatSeatLabel, routeLabelOf } from "../utils/ticket";
import { formatTakeoffDate, formatTakeoffDateTime, toDate } from "../utils/datetime";

const refName = (ref: string | { name?: string } | undefined, fallback = "N/A") =>
  typeof ref === "object" && ref ? ref.name : fallback;

type StatusFilter = "All" | "Booked" | "Pending" | "Cancelled";

const FILTERS: StatusFilter[] = ["All", "Booked", "Pending", "Cancelled"];

const BookingHistory = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("All");

  const isCancelled = (b: Booking) => (b.status || "").toLowerCase().includes("cancel");

  const fetchHistory = useCallback(async () => {
    const token = localStorage.getItem("token");
    const userId = localStorage.getItem("userId");

    if (!token || !userId) {
      setError("User not logged in.");
      setLoading(false);
      return;
    }

    try {
      const data = await refundsApi.getHistory(userId);
      setBookings(data as Booking[]);
    } catch (err) {
      console.error("Error fetching history:", err);
      setError("Failed to load booking history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const counts = useMemo(
    () => ({
      All: bookings.length,
      Booked: bookings.filter((b) => b.status === "Booked").length,
      Pending: bookings.filter((b) => b.status === "Pending" && !isCancelled(b)).length,
      Cancelled: bookings.filter(isCancelled).length,
    }),
    [bookings]
  );

  const visibleBookings = useMemo(() => {
    if (filter === "All") return bookings;
    return bookings.filter((b) =>
      filter === "Cancelled" ? isCancelled(b) : b.status === filter && !isCancelled(b)
    );
  }, [bookings, filter]);

  const Ticket = ({ booking }: { booking: Booking }) => {
    const isBus = !!booking.busId;
    const isCoD =
      booking.paymentMethod === "CashOnVisit" || booking.paymentStatus === "CashOnVisit";
    const bookingRef = isBus ? booking.busId : booking.vehicleId;
    // Take-off straight from the database: the value snapshotted on the booking
    // wins, then the populated bus/vehicle. Never "now", never createdAt.
    const departure =
      toDate(booking.takeOffDate) ||
      toDate(booking.reservationDate) ||
      (typeof bookingRef === "object" && bookingRef ? toDate(bookingRef.takeOffDate) : null);
    const departDate = formatTakeoffDate(departure, { withWeekday: true });
    const departDateTime = formatTakeoffDateTime(departure);

    const cancelled = (booking.status || "").toLowerCase().includes("cancel");
    const statusPill = cancelled
      ? { label: booking.status || "Cancelled", cls: "border-rose-500/40 bg-rose-500/15 text-rose-400" }
      : booking.status === "Booked"
      ? { label: "Booked", cls: "border-teal-500/40 bg-teal-500/15 text-teal-400" }
      : { label: booking.status || "Pending", cls: "border-amber-500/40 bg-amber-500/15 text-amber-400" };

    const name = refName(isBus ? booking.busId : booking.vehicleId, "Reserved Vehicle");
    // Canonical route: the value snapshotted on the booking wins over the ref.
    const [pickup, drop] = routeLabelOf(booking).split(" → ");
    const seatLabels = booking.selectedSeats?.length
      ? booking.selectedSeats.map(formatSeatLabel)
      : [];

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-card transition hover:shadow-card-lg"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dashed border-slate-700 bg-slate-800/70 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-slate-900 p-3">
              {isBus ? (
                <FaBus className="text-xl text-blue-400" />
              ) : (
                <FaTicketAlt className="text-xl text-amber-400" />
              )}
            </span>
            <div>
              <h2 className="text-lg font-bold text-white sm:text-xl">{name}</h2>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Booking No: {bookingNumberOf(booking)}
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-2 text-sm font-medium text-slate-300 md:flex">
            <span className="max-w-[8rem] truncate">{pickup}</span>
            <FaArrowRight className="shrink-0 text-teal-400" />
            <span className="max-w-[8rem] truncate">{drop}</span>
          </div>
        </div>

        <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-3 md:p-7">
          <div className="space-y-4 md:border-r md:border-slate-700 md:pr-6">
            <div className="flex items-center gap-3">
              <FaMapMarkerAlt className="text-lg text-teal-400" />
              <div>
                <p className="text-sm text-slate-400">Departure</p>
                <p className="font-medium text-white">{pickup}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <FaMapMarkerAlt className="text-lg text-rose-400" />
              <div>
                <p className="text-sm text-slate-400">Destination</p>
                <p className="font-medium text-white">{drop}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <FaCalendarAlt className="text-lg text-blue-400" />
              <div>
                <p className="text-sm text-slate-400">Trip Date</p>
                <p className="font-medium text-white">{departDate}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4 md:border-r md:border-slate-700 md:pr-6">
            <div className="flex items-center gap-3">
              <FaChair className="text-lg text-purple-400" />
              <div className="min-w-0">
                <p className="mb-1 text-sm text-slate-400">Seats</p>
                {seatLabels.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {seatLabels.map((seat) => (
                      <span
                        key={seat}
                        className="rounded-md bg-teal-500/15 px-2 py-0.5 text-sm font-semibold text-teal-300"
                      >
                        {seat}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-300">{isBus ? "Not specified" : "Full Reserved"}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <FaTag className="text-lg text-amber-400" />
              <div>
                <p className="text-sm text-slate-400">Total Paid</p>
                <p className="text-xl font-bold text-white">NPR {booking.totalPrice}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-800/50 p-4">
            <div className="flex flex-wrap gap-2">
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusPill.cls}`}
              >
                {statusPill.label}
              </span>
              {isCoD && (
                <span className="rounded-full border border-blue-500/40 bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-400">
                  Cash on Visit
                </span>
              )}
            </div>
            {booking.createdAt && (
              <div className="mt-auto flex items-center gap-2 text-sm text-slate-400">
                <FaRegClock />
                Booked {formatTakeoffDate(booking.createdAt, { withWeekday: true })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-700 bg-slate-800 p-4 px-5 text-sm text-slate-400 sm:px-6">
          <FaCalendarAlt />
          <span>Departure: {departDateTime}</span>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-r from-teal-500 via-teal-600 to-slate-900 p-6 text-white shadow-card sm:p-8">
          <div className="flex items-center gap-4">
            <span className="rounded-2xl bg-white/10 p-3">
              <FaQrcode className="text-2xl" />
            </span>
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">Booking History</h1>
              <p className="mt-1 text-sm text-teal-100/80">
                Review every trip you have made with TickXplore.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  filter === f
                    ? "bg-white text-slate-900 shadow"
                    : "bg-white/10 text-teal-50 hover:bg-white/20"
                }`}
              >
                {f} · {counts[f]}
              </button>
            ))}
          </div>
        </header>

        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center">
            <ImSpinner8 className="mb-4 animate-spin text-4xl text-teal-600" />
            <p className="text-lg text-slate-500">Loading your history...</p>
          </div>
        ) : error ? (
          <div className="mx-auto max-w-xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
            <p className="font-semibold text-rose-700">{error}</p>
            {error === "User not logged in." && (
              <Link
                to="/sign-in"
                className="mt-4 inline-block rounded-xl bg-rose-600 px-5 py-2.5 font-semibold text-white transition hover:bg-rose-700"
              >
                Sign in
              </Link>
            )}
          </div>
        ) : bookings.length === 0 ? (
          <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-card">
            <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-teal-50">
              <FaTicketAlt className="text-2xl text-teal-600" />
            </span>
            <h2 className="text-xl font-bold text-slate-900">No trips yet</h2>
            <p className="mt-2 text-slate-500">
              When you book a bus or vehicle, your journey will appear here.
            </p>
            <Link
              to="/tickets"
              className="mt-6 inline-block rounded-xl bg-teal-600 px-6 py-3 font-semibold text-white transition hover:bg-teal-700"
            >
              Browse available buses
            </Link>
          </div>
        ) : visibleBookings.length === 0 ? (
          <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-card">
            <h2 className="text-xl font-bold text-slate-900">No {filter} bookings</h2>
            <p className="mt-2 text-slate-500">
              Try a different filter to see more of your history.
            </p>
          </div>
        ) : (
          <div className="grid gap-6">
            {visibleBookings.map((booking) => (
              <Ticket key={booking._id} booking={booking} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default BookingHistory;