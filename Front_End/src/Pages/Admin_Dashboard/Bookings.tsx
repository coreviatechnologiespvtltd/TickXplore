import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaMoneyBillWave,
  FaHandHoldingUsd,
  FaWallet,
  FaTicketAlt,
  FaSearch,
} from "react-icons/fa";
import { getPageRange } from "../../utils/pagination";
import { bookingNumberOf, formatSeatLabel } from "../../utils/ticket";
import AdminPageHeader from "../../Component/Admin Component/AdminPageHeader";
import EmailStatusBadge from "../../Component/EmailStatusBadge";
import { bookingsApi, type Booking } from "../../api";

interface OutletContext {
  bookings: Booking[];
  loading: boolean;
  error: string;
  fetchData: () => void;
}

const PAGE_SIZE = 10;

const isCoD = (booking: Booking) =>
  booking.paymentMethod === "CashOnVisit" || booking.paymentStatus === "CashOnVisit";

const statusPill = (status: string) =>
  status === "Booked"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
    : status === "Pending"
    ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
    : "border-rose-500/30 bg-rose-500/10 text-rose-600";

const Bookings = () => {
  const { bookings, loading, error, fetchData } = useOutletContext<OutletContext>();
  const [bookingType, setBookingType] = useState<"bus" | "vehicle">("bus");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);

  const handleResend = async (id: string) => {
    setSendingEmailId(id);
    try {
      await bookingsApi.sendTicket(id);
      toast.success("Ticket emailed to the customer.");
      fetchData();
    } catch (err) {
      const axiosErr = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(axiosErr.response?.data?.message || axiosErr.message || "Failed to email the ticket.");
    } finally {
      setSendingEmailId(null);
    }
  };

  const filteredBookings = bookings
    .filter((booking) => (bookingType === "bus" ? booking.bus : booking.vehicle))
    .filter((booking) => {
      const query = searchQuery.toLowerCase();
      return (
        (booking.bookingNumber ?? "").includes(searchQuery) ||
        booking._id.includes(searchQuery) ||
        booking.user?.name?.toLowerCase().includes(query) ||
        booking.bus?.name?.toLowerCase().includes(query) ||
        booking.vehicle?.name?.toLowerCase().includes(query)
      );
    })
    .filter((booking) => {
      if (!dateFilter || !booking.createdAt) return true;
      const bookingDay = new Date(booking.createdAt).toLocaleDateString("en-CA");
      return bookingDay === dateFilter;
    });

  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const pagedBookings = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredBookings.slice(start, start + PAGE_SIZE);
  }, [filteredBookings, safePage]);

  const startIndex = (safePage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filteredBookings.length);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const stats = useMemo(
    () => ({
      revenue: bookings.reduce((sum, b) => sum + (Number(b.totalPrice) || 0), 0),
      commission: bookings.reduce((sum, b) => sum + (Number(b.commissionAmount) || 0), 0),
      earnings: bookings.reduce((sum, b) => sum + (Number(b.vendorEarnings) || 0), 0),
      booked: bookings.filter((b) => b.status === "Booked").length,
      pending: bookings.filter((b) => b.status === "Pending").length,
      cod: bookings.filter(isCoD).length,
    }),
    [bookings]
  );

  if (loading)
    return (
      <div className="flex h-64 items-center justify-center text-gray-500">
        Loading bookings...
      </div>
    );
  if (error)
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-600">
        Error loading bookings: {error}
      </div>
    );

  const money = (value: number | undefined) =>
    `NPR ${(Number(value) || 0).toFixed(2)}`;

  const statCards = [
    {
      label: "Total Revenue",
      value: money(stats.revenue),
      icon: <FaMoneyBillWave />,
      accent: "bg-emerald-500/10 text-emerald-700",
    },
    {
      label: "Commission",
      value: money(stats.commission),
      icon: <FaHandHoldingUsd />,
      accent: "bg-amber-500/10 text-amber-700",
    },
    {
      label: "Vendor Earnings",
      value: money(stats.earnings),
      icon: <FaWallet />,
      accent: "bg-indigo-500/10 text-indigo-700",
    },
    {
      label: "Bookings",
      value: String(bookings.length),
      icon: <FaTicketAlt />,
      accent: "bg-violet-500/10 text-violet-700",
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Payment Management"
        subtitle="Track revenue, commissions and vendor earnings across all bookings."
      >
        <button
          onClick={() => setBookingType("bus")}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
            bookingType === "bus"
              ? "bg-white text-indigo-700 shadow"
              : "bg-white/10 text-indigo-50 hover:bg-white/20"
          }`}
        >
          Bus Bookings
        </button>
        <button
          onClick={() => setBookingType("vehicle")}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
            bookingType === "vehicle"
              ? "bg-white text-indigo-700 shadow"
              : "bg-white/10 text-indigo-50 hover:bg-white/20"
          }`}
        >
          Vehicle Bookings
        </button>
      </AdminPageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl bg-white p-5 shadow-card transition-shadow hover:shadow-card-lg"
          >
            <div className="flex items-center gap-2">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.accent}`}>
                {card.icon}
              </span>
              <span className="text-xs font-medium text-gray-500">{card.label}</span>
            </div>
            <p className="mt-2 truncate text-lg font-bold text-slate-900">{card.value}</p>
            {card.label === "Bookings" && (
              <p className="mt-1 text-xs text-gray-500">
                {stats.booked} booked · {stats.pending} pending · {stats.cod} cash on visit
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search bookings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-gray-300 py-2 pl-10 pr-3 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="rounded-xl border border-gray-300 p-2 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
            {dateFilter && (
              <button
                onClick={() => setDateFilter("")}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-100"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="bg-indigo-600 text-white">
                <th className="px-4 py-3 text-left font-semibold">Booking No</th>
                <th className="px-4 py-3 text-left font-semibold">User</th>
                <th className="px-4 py-3 text-left font-semibold">
                  {bookingType === "bus" ? "Bus" : "Vehicle"}
                </th>
                {bookingType === "bus" ? (
                  <th className="px-4 py-3 text-left font-semibold">Seats</th>
                ) : (
                  <>
                    <th className="px-4 py-3 text-left font-semibold">Pickup</th>
                    <th className="px-4 py-3 text-left font-semibold">Drop</th>
                  </>
                )}
                <th className="px-4 py-3 text-right font-semibold">Price</th>
                <th className="px-4 py-3 text-right font-semibold">Commission</th>
                <th className="px-4 py-3 text-right font-semibold">Vendor Earnings</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Email</th>
                <th className="px-4 py-3 text-left font-semibold">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {pagedBookings.map((booking) => (
                <tr key={booking._id} className="transition-colors hover:bg-slate-50">
                  <td
                    className="px-4 py-3 font-mono text-xs font-semibold text-slate-600"
                    title={bookingNumberOf(booking)}
                  >
                    #{bookingNumberOf(booking)}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {booking.user?.name || "N/A"}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {booking.bus?.name || booking.vehicle?.name || "N/A"}
                  </td>
                  {bookingType === "bus" ? (
                    <td className="px-4 py-3 text-gray-700">
                      {booking.selectedSeats?.map(formatSeatLabel).join(", ") || "—"}
                    </td>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-gray-700">
                        {booking.pickupPoint || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{booking.dropPoint || "—"}</td>
                    </>
                  )}
                  <td className="px-4 py-3 text-right font-semibold text-indigo-700">
                    {money(booking.totalPrice)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {money(booking.commissionAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-700">
                    {money(booking.vendorEarnings)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1.5">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusPill(
                          booking.status || ""
                        )}`}
                      >
                        {booking.status || "Unknown"}
                      </span>
                      {isCoD(booking) && (
                        <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                          Cash on Visit
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1.5">
                      <EmailStatusBadge status={booking.emailStatus} error={booking.emailError} />
                      {booking.customerEmail && booking.status !== "Cancelled" && (
                        <button
                          onClick={() => handleResend(booking._id)}
                          disabled={sendingEmailId === booking._id}
                          className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {sendingEmailId === booking._id ? "Sending…" : "Resend Ticket"}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {booking.createdAt
                      ? new Date(booking.createdAt).toLocaleString()
                      : "N/A"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredBookings.length === 0 && (
            <p className="py-8 text-center text-gray-500">No bookings found.</p>
          )}
        </div>

        {filteredBookings.length > PAGE_SIZE && (
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-gray-500">
              Showing {startIndex + 1}-{endIndex} of {filteredBookings.length}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Prev
              </button>
              {getPageRange(safePage, totalPages).map((p, i) =>
                p === "..." ? (
                  <span key={`ellipsis-${i}`} className="px-2 py-1 text-sm text-gray-400">
                    ...
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`rounded-lg px-3 py-1 text-sm transition-colors ${
                      p === safePage
                        ? "bg-indigo-600 text-white"
                        : "border border-gray-300 text-gray-600 hover:bg-slate-100"
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Bookings;