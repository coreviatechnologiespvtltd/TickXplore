import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaMoneyBillWave,
  FaHandHoldingUsd,
  FaWallet,
  FaTicketAlt,
} from "react-icons/fa";
import { FiDownload } from "react-icons/fi";
import { getPageRange } from "../../utils/pagination";
import { earningsOf, formatMoney } from "../../utils/format";
import { bookingNumberOf, formatSeatLabel } from "../../utils/ticket";
import ConfirmDialog from "../../Component/ConfirmDialog";
import AdminPageHeader from "../../Component/Admin Component/AdminPageHeader";
import EmailStatusBadge from "../../Component/EmailStatusBadge";
import { bookingsApi, type Booking, type BookingRef } from "../../api";

interface OutletContext {
  bookings: Booking[];
  fetchData: () => void;
}

const PAGE_SIZE = 10;

const STATUS_FILTERS = ["", "Booked", "Pending", "Cancelled"] as const;

const statusPill = (status: string) =>
  status === "Booked"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
    : status === "Pending"
    ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
    : "border-rose-500/30 bg-rose-500/10 text-rose-600";

const isCoD = (booking: Booking) =>
  booking.paymentMethod === "CashOnVisit" || booking.paymentStatus === "CashOnVisit";

const isCoDPending = (booking: Booking) =>
  booking.status === "Pending" && isCoD(booking);

const Bookings = () => {
  const { bookings, fetchData } = useOutletContext<OutletContext>();
  const [dateFilter, setDateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("");
  const [page, setPage] = useState(1);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<Booking | null>(null);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [dateFilter, search, statusFilter]);

  const filteredBookings = useMemo(() => {
    const query = search.trim().toLowerCase();
    return bookings.filter((booking) => {
      if (dateFilter) {
        if (!booking.createdAt) return false;
        const bookingDay = new Date(booking.createdAt).toLocaleDateString("en-CA");
        if (bookingDay !== dateFilter) return false;
      }
      if (statusFilter && booking.status !== statusFilter) return false;
      if (query) {
        const user = booking.userId as { name?: string } | undefined;
        const busRef = booking.busId as BookingRef | undefined;
        const vehicleRef = booking.vehicleId as BookingRef | undefined;
        const haystack = [
          booking._id,
          booking.bookingNumber,
          user?.name,
          booking.customerName,
          booking.customerPhone,
          booking.customerEmail,
          busRef?.name,
          vehicleRef?.name,
          booking.paymentMethod,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [bookings, dateFilter, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const pagedBookings = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredBookings.slice(start, start + PAGE_SIZE);
  }, [filteredBookings, safePage]);

  const startIndex = (safePage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filteredBookings.length);

  const bookedBookings = useMemo(
    () => bookings.filter((b) => b.status === "Booked"),
    [bookings]
  );

  const stats = useMemo(
    () => ({
      revenue: bookedBookings.reduce((sum, b) => sum + (Number(b.totalPrice) || 0), 0),
      commission: bookedBookings.reduce(
        (sum, b) => sum + (Number(b.commissionAmount) || 0),
        0
      ),
      earnings: bookedBookings.reduce((sum, b) => sum + earningsOf(b), 0),
      booked: bookedBookings.length,
      pending: bookings.filter((b) => b.status === "Pending").length,
      cod: bookings.filter(isCoD).length,
    }),
    [bookings, bookedBookings]
  );

  const statCards = [
    {
      label: "Total Revenue",
      value: formatMoney(stats.revenue, 2),
      icon: <FaMoneyBillWave />,
      accent: "bg-emerald-500/10 text-emerald-700",
    },
    {
      label: "Commission",
      value: formatMoney(stats.commission, 2),
      icon: <FaHandHoldingUsd />,
      accent: "bg-amber-500/10 text-amber-700",
    },
    {
      label: "Vendor Earnings",
      value: formatMoney(stats.earnings, 2),
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

  const clearFilters = () => {
    setDateFilter("");
    setSearch("");
    setStatusFilter("");
    setPage(1);
  };

  const handleConfirmRequest = (booking: Booking) => setPendingConfirm(booking);

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

  const handleConfirm = async () => {
    const id = pendingConfirm?._id;
    if (!id) return;
    setConfirmingId(id);
    try {
      await bookingsApi.confirmBooking(id);
      toast.success("Booking confirmed.");
      fetchData();
    } catch (err) {
      console.error("Confirm booking error:", err);
      toast.error("Failed to confirm booking.");
    } finally {
      setConfirmingId(null);
      setPendingConfirm(null);
    }
  };

  const exportCsv = () => {
    const headers = [
      "Booking No",
      "User",
      "Transport",
      "Seats",
      "Price",
      "Commission",
      "Vendor Earnings",
      "Status",
      "Payment Method",
      "Date",
    ];
    const rows = filteredBookings.map((b) => {
      const user = b.userId as { name?: string } | undefined;
      const busRef = b.busId as BookingRef | undefined;
      const vehicleRef = b.vehicleId as BookingRef | undefined;
      return [
        bookingNumberOf(b),
        user?.name || b.customerName || "",
        busRef?.name || vehicleRef?.name || "",
        b.selectedSeats?.map(formatSeatLabel).join(" ") || "",
        b.totalPrice ?? 0,
        b.commissionAmount ?? 0,
        earningsOf(b),
        b.status || "",
        b.paymentMethod || "",
        b.createdAt ? new Date(b.createdAt).toLocaleString() : "",
      ];
    });
    const csv = [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vendor-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Payment Management"
        subtitle="Track revenue, commissions and vendor earnings, and confirm Cash on Visit bookings."
      >
        <span className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-indigo-700 shadow">
          {stats.booked} booked · {stats.pending} pending · {stats.cod} cash on visit
        </span>
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50"
        >
          <FiDownload />
          Export
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
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold text-slate-900">Bookings</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by ID, user or transport..."
                aria-label="Search bookings"
                className="w-full rounded-xl border border-gray-300 p-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 sm:w-64"
              />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                aria-label="Filter by date"
                className="rounded-xl border border-gray-300 p-2 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status || "all"}
                onClick={() => setStatusFilter(status)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  statusFilter === status
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-gray-300 text-gray-600 hover:bg-slate-50"
                }`}
              >
                {status || "All"}
              </button>
            ))}
            {(dateFilter || search || statusFilter) && (
              <button
                onClick={clearFilters}
                className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-100"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          {filteredBookings.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-lg font-semibold text-slate-700">No bookings found</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                {bookings.length === 0
                  ? "Bookings will appear here once customers reserve your transport."
                  : "Try adjusting the search or filters above."}
              </p>
              {bookings.length > 0 && (
                <button
                  onClick={clearFilters}
                  className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="bg-indigo-600 text-white">
                  <th scope="col" className="px-4 py-3 text-left font-semibold">
                    Booking No
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold">
                    User
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold">
                    Bus / Vehicle
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold">
                    Seats
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Price
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Commission
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Vendor Earnings
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {pagedBookings.map((booking) => {
                  const user = booking.userId as { name?: string } | undefined;
                  const busRef = booking.busId as BookingRef | undefined;
                  const vehicleRef = booking.vehicleId as BookingRef | undefined;
                  return (
                    <tr key={booking._id} className="transition-colors hover:bg-slate-50">
                      <td
                        className="px-4 py-3 font-mono text-xs font-semibold text-slate-600"
                        title={bookingNumberOf(booking)}
                      >
                        #{bookingNumberOf(booking)}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {user?.name || booking.customerName || "N/A"}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {busRef?.name || vehicleRef?.name || "N/A"}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {booking.selectedSeats?.map(formatSeatLabel).join(", ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-indigo-700">
                        {formatMoney(booking.totalPrice, 2)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {formatMoney(booking.commissionAmount, 2)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {formatMoney(earningsOf(booking), 2)}
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
                          {isCoDPending(booking) && (
                            <button
                              onClick={() => handleConfirmRequest(booking)}
                              disabled={confirmingId === booking._id}
                              className="mt-0.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {confirmingId === booking._id ? "Confirming..." : "Confirm Payment"}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1.5">
                          <EmailStatusBadge
                            status={booking.emailStatus}
                            error={booking.emailError}
                          />
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
                          ? new Date(booking.createdAt).toLocaleDateString()
                          : "N/A"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

      <ConfirmDialog
        open={pendingConfirm !== null}
        title="Confirm payment"
        message={`Confirm the cash payment for booking #${bookingNumberOf(pendingConfirm)}?`}
        confirmLabel="Confirm"
        tone="success"
        busy={confirmingId !== null}
        onConfirm={handleConfirm}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
};

export default Bookings;