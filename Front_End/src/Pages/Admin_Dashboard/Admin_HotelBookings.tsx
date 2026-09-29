import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FiEye, FiFilter, FiCalendar, FiDollarSign, FiUser, FiLoader } from "react-icons/fi";
import { toast } from "react-toastify";
import Admin_DataTable from "../../Component/Admin Component/Admin_DataTable";
import AdminPageHeader from "../../Component/Admin Component/AdminPageHeader";
import { bookingsApi } from "../../api";

interface HotelBooking {
  _id: string;
  bookingNumber: string;
  hotelId: string;
  hotelName: string;
  roomId: string;
  roomName: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone?: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  totalPrice: number;
  commissionAmount?: number;
  status: "booked" | "cancelled" | "completed" | "pending";
  paymentStatus: "paid" | "pending" | "refunded" | "failed";
  paymentMethod?: string;
  createdAt: string;
}

interface OutletContext {
  fetchData: () => void;
}

const columns = [
  { key: "bookingNumber", label: "Booking #" },
  { key: "hotelName", label: "Hotel" },
  { key: "roomName", label: "Room" },
  { key: "userName", label: "Guest", render: (v: string, row: HotelBooking) => (
    <div>
      <div className="font-medium">{v}</div>
      <div className="text-xs text-slate-500">{row.userEmail}</div>
    </div>
  )},
  { key: "checkIn", label: "Check-in", render: (v: string) => new Date(v).toLocaleDateString() },
  { key: "checkOut", label: "Check-out", render: (v: string) => new Date(v).toLocaleDateString() },
  { key: "nights", label: "Nights", render: (v: number) => <span className="flex items-center gap-1"><FiCalendar size={12} className="text-slate-400" />{v}</span> },
  { key: "guests", label: "Guests", render: (v: number) => <span className="flex items-center gap-1"><FiUser size={12} className="text-slate-400" />{v}</span> },
  { key: "totalPrice", label: "Total", render: (v: number) => <span className="flex items-center gap-1"><FiDollarSign size={12} className="text-slate-400" />{v.toLocaleString()}</span> },
  { key: "status", label: "Status", badge: true },
  { key: "paymentStatus", label: "Payment", badge: true },
  { key: "createdAt", label: "Booked", render: (v: string) => new Date(v).toLocaleDateString() },
];

const Admin_HotelBookings = () => {
  const { fetchData } = useOutletContext<OutletContext>();
  const [bookings, setBookings] = useState<HotelBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 20;

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (search) params.append("q", search);
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (paymentFilter !== "all") params.append("paymentStatus", paymentFilter);
      const res = await bookingsApi.getHotelBookings(Object.fromEntries(params));
      setBookings(res.bookings || []);
      setTotalPages(res.totalPages || 1);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load hotel bookings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, [page, search, statusFilter, paymentFilter]);

  const renderActions = (booking: HotelBooking) => (
    <div className="flex items-center gap-1">
      <button
        onClick={() => window.open(`/admin/bookings/hotel/${booking._id}`, "_blank")}
        className="p-1.5 rounded hover:bg-blue-100 text-blue-600"
        title="View Details"
      >
        <FiEye size={16} />
      </button>
    </div>
  );

  const statusColors: Record<string, string> = {
    booked: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
    completed: "bg-blue-100 text-blue-800",
    pending: "bg-yellow-100 text-yellow-800",
  };

  const paymentColors: Record<string, string> = {
    paid: "bg-green-100 text-green-800",
    pending: "bg-yellow-100 text-yellow-800",
    refunded: "bg-purple-100 text-purple-800",
    failed: "bg-red-100 text-red-800",
  };

  const statuses = ["all", "booked", "cancelled", "completed", "pending"];
  const paymentStatuses = ["all", "paid", "pending", "refunded", "failed"];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Hotel Bookings"
        subtitle="View and manage all hotel room bookings"
        icon={FiCalendar}
      />

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <FiFilter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search bookings..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-w-[160px]"
        >
          {statuses.map((s) => <option key={s} value={s}>{s === "all" ? "All Statuses" : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select
          value={paymentFilter}
          onChange={(e) => { setPaymentFilter(e.target.value); setPage(1); }}
          className="px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-w-[160px]"
        >
          {paymentStatuses.map((s) => <option key={s} value={s}>{s === "all" ? "All Payments" : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>

      <Admin_DataTable
        data={bookings}
        columns={columns}
        loading={loading}
        emptyMessage="No hotel bookings found"
        renderActions={renderActions}
        customCellRenderers={{
          status: (v: string) => (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[v] || "bg-gray-100 text-gray-800"}`}>
              {v}
            </span>
          ),
          paymentStatus: (v: string) => (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentColors[v] || "bg-gray-100 text-gray-800"}`}>
              {v}
            </span>
          ),
        }}
        pagination={{
          currentPage: page,
          totalPages,
          onPageChange: setPage,
        }}
      />
    </div>
  );
};

export default Admin_HotelBookings;