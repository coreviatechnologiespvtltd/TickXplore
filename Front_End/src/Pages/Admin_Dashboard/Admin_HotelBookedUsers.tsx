import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FiEye, FiFilter, FiUser, FiCalendar, FiMapPin, FiLoader } from "react-icons/fi";
import { toast } from "react-toastify";
import Admin_DataTable from "../../Component/Admin Component/Admin_DataTable";
import AdminPageHeader from "../../Component/Admin Component/AdminPageHeader";
import { bookingsApi } from "../../api";

interface BookedUser {
  _id: string;
  name: string;
  email: string;
  phoneNumber?: string;
  location?: string;
  totalBookings: number;
  totalSpent: number;
  lastBookingDate?: string;
  bookings: {
    _id: string;
    bookingNumber: string;
    hotelName: string;
    roomName: string;
    checkIn: string;
    checkOut: string;
    totalPrice: number;
    status: string;
  }[];
}

interface OutletContext {
  fetchData: () => void;
}

const columns = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phoneNumber", label: "Phone" },
  { key: "location", label: "Location", render: (v: string) => v ? <span className="flex items-center gap-1"><FiMapPin size={12} className="text-slate-400" />{v}</span> : "—" },
  { key: "totalBookings", label: "Total Bookings", render: (v: number) => <span className="font-medium">{v}</span> },
  { key: "totalSpent", label: "Total Spent", render: (v: number) => `₨${v.toLocaleString()}` },
  { key: "lastBookingDate", label: "Last Booking", render: (v: string) => v ? new Date(v).toLocaleDateString() : "—" },
];

const Admin_HotelBookedUsers = () => {
  const { fetchData } = useOutletContext<OutletContext>();
  const [users, setUsers] = useState<BookedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 20;

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (search) params.append("q", search);
      const res = await bookingsApi.getHotelBookedUsers(Object.fromEntries(params));
      setUsers(res.users || []);
      setTotalPages(res.totalPages || 1);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load booked users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [page, search]);

  const renderActions = (user: BookedUser) => (
    <div className="flex items-center gap-1">
      <button
        onClick={() => showUserBookings(user)}
        className="p-1.5 rounded hover:bg-blue-100 text-blue-600"
        title="View Bookings"
      >
        <FiEye size={16} />
      </button>
    </div>
  );

  const [selectedUser, setSelectedUser] = useState<BookedUser | null>(null);

  const showUserBookings = (user: BookedUser) => {
    setSelectedUser(user);
  };

  const statusColors: Record<string, string> = {
    booked: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
    completed: "bg-blue-100 text-blue-800",
    pending: "bg-yellow-100 text-yellow-800",
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Hotel Booked Users"
        subtitle="View users who have booked hotels and their booking history"
        icon={FiUser}
      />

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <FiFilter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      <Admin_DataTable
        data={users}
        columns={columns}
        loading={loading}
        emptyMessage="No users with hotel bookings found"
        renderActions={renderActions}
        pagination={{
          currentPage: page,
          totalPages,
          onPageChange: setPage,
        }}
      />

      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold">Bookings for {selectedUser.name}</h3>
              <button
                onClick={() => setSelectedUser(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {selectedUser.bookings.length === 0 ? (
                <p className="text-center text-slate-500 py-8">No bookings found</p>
              ) : (
                <div className="space-y-3">
                  {selectedUser.bookings.map((booking) => (
                    <div
                      key={booking._id}
                      className="bg-slate-50 rounded-xl p-4 border border-slate-200"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 text-sm text-slate-600 mb-2">
                            <span className="font-medium text-slate-900">{booking.hotelName}</span>
                            <span className="text-slate-400">•</span>
                            <span>{booking.roomName}</span>
                          </div>
                          <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                            <span className="flex items-center gap-1">
                              <FiCalendar size={14} />
                              {new Date(booking.checkIn).toLocaleDateString()} - {new Date(booking.checkOut).toLocaleDateString()}
                            </span>
                            <span className="font-medium text-indigo-600">₨{booking.totalPrice.toLocaleString()}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[booking.status] || "bg-gray-100 text-gray-800"}`}>
                              {booking.status}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => window.open(`/admin/bookings/hotel/${booking._id}`, "_blank")}
                          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 whitespace-nowrap"
                        >
                          View Details
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin_HotelBookedUsers;