import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FiPlus, FiEdit, FiTrash, FiEye, FiLoader, FiFilter, FiHome, FiMapPin } from "react-icons/fi";
import { toast } from "react-toastify";
import Admin_DataTable from "../../Component/Admin Component/Admin_DataTable";
import AdminPageHeader from "../../Component/Admin Component/AdminPageHeader";
import { adminApi } from "../../api";

interface Hotel {
  _id: string;
  hotelId: string;
  hotelName: string;
  email: string;
  phoneNumber?: string;
  city: string;
  address: string;
  type: string;
  starRating: number;
  coverImage?: string;
  imageCount: number;
  amenityCount: number;
  isActive: boolean;
  applicationStatus: "pending" | "approved" | "declined";
  listingStatus: string;
  submittedAt?: string;
  publishedAt?: string;
  publishedVersion: number;
  createdAt: string;
}

interface OutletContext {
  fetchData: () => void;
  activateHotelAccount: (id: string, isActive: boolean) => void;
  suspendHotelListing: (id: string, reason?: string) => void;
  reinstateHotelListing: (id: string, reason?: string) => void;
  archiveHotelListing: (id: string, reason?: string) => void;
  handleDeleteHotel: (id: string) => void;
}

const columns = [
  { key: "hotelName", label: "Hotel Name" },
  { key: "hotelId", label: "Hotel ID" },
  { key: "email", label: "Email" },
  { key: "city", label: "City", render: (v: string) => <span className="flex items-center gap-1"><FiMapPin size={12} className="text-slate-400" />{v}</span> },
  { key: "type", label: "Type" },
  { key: "starRating", label: "Stars", render: (v: number) => "⭐".repeat(v || 0) },
  { key: "listingStatus", label: "Listing Status", badge: true },
  { key: "applicationStatus", label: "Account", badge: true },
  { key: "createdAt", label: "Created", render: (v: string) => new Date(v).toLocaleDateString() },
];

const Admin_Hotels = () => {
  const { fetchData, activateHotelAccount, suspendHotelListing, reinstateHotelListing, archiveHotelListing, handleDeleteHotel } = useOutletContext<OutletContext>();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 20;

  const fetchHotels = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (search) params.append("q", search);
      if (statusFilter !== "all") params.append("listingStatus", statusFilter);
      const res = await adminApi.getHotels(Object.fromEntries(params));
      setHotels(res.hotels || []);
      setTotalPages(res.totalPages || 1);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load hotels");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHotels();
  }, [page, search, statusFilter]);

  const handleDelete = async (hotelId: string, hotelName: string) => {
    if (!confirm(`Delete "${hotelName}"? This cannot be undone if there are no bookings.`)) return;
    const toastId = toast.loading("Deleting hotel...");
    try {
      await handleDeleteHotel(hotelId);
      toast.update(toastId, { render: "Hotel deleted", type: "success", isLoading: false });
      fetchHotels();
      fetchData();
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, { render: axiosErr.response?.data?.message || "Failed to delete", type: "error", isLoading: false });
    }
  };

  const handleActivate = async (hotelId: string, activate: boolean) => {
    const toastId = toast.loading(activate ? "Activating..." : "Deactivating...");
    try {
      await activateHotelAccount(hotelId, activate);
      toast.update(toastId, { render: activate ? "Activated" : "Deactivated", type: "success", isLoading: false });
      fetchHotels();
      fetchData();
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, { render: axiosErr.response?.data?.message || "Failed", type: "error", isLoading: false });
    }
  };

  const handleSuspend = async (hotelId: string) => {
    const reason = prompt("Suspension reason:");
    if (!reason) return;
    const toastId = toast.loading("Suspending...");
    try {
      await suspendHotelListing(hotelId, reason);
      toast.update(toastId, { render: "Suspended", type: "success", isLoading: false });
      fetchHotels();
      fetchData();
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, { render: axiosErr.response?.data?.message || "Failed", type: "error", isLoading: false });
    }
  };

  const handleReinstate = async (hotelId: string) => {
    const toastId = toast.loading("Reinstating...");
    try {
      await reinstateHotelListing(hotelId);
      toast.update(toastId, { render: "Reinstated", type: "success", isLoading: false });
      fetchHotels();
      fetchData();
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, { render: axiosErr.response?.data?.message || "Failed", type: "error", isLoading: false });
    }
  };

  const handleArchive = async (hotelId: string) => {
    const reason = prompt("Archive reason:");
    if (!reason) return;
    const toastId = toast.loading("Archiving...");
    try {
      await archiveHotelListing(hotelId, reason);
      toast.update(toastId, { render: "Archived", type: "success", isLoading: false });
      fetchHotels();
      fetchData();
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, { render: axiosErr.response?.data?.message || "Failed", type: "error", isLoading: false });
    }
  };

  const renderActions = (hotel: Hotel) => (
    <div className="flex items-center gap-1">
      <button
        onClick={() => window.open(`/admin/hotels/${hotel._id}`, "_blank")}
        className="p-1.5 rounded hover:bg-blue-100 text-blue-600"
        title="View Details"
      >
        <FiEye size={16} />
      </button>
      <button
        onClick={() => window.open(`/admin/hotels/${hotel._id}/edit`, "_blank")}
        className="p-1.5 rounded hover:bg-indigo-100 text-indigo-600"
        title="Edit"
      >
        <FiEdit size={16} />
      </button>
      {hotel.listingStatus === "published" && (
        <button
          onClick={() => handleSuspend(hotel._id)}
          className="p-1.5 rounded hover:bg-orange-100 text-orange-600"
          title="Suspend"
        >
          <FiFilter size={16} />
        </button>
      )}
      {hotel.listingStatus === "suspended" && (
        <button
          onClick={() => handleReinstate(hotel._id)}
          className="p-1.5 rounded hover:bg-green-100 text-green-600"
          title="Reinstate"
        >
          <FiPlus size={16} />
        </button>
      )}
      {["published", "suspended", "rejected"].includes(hotel.listingStatus) && (
        <button
          onClick={() => handleArchive(hotel._id)}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
          title="Archive"
        >
          <FiHome size={16} />
        </button>
      )}
      <button
        onClick={() => handleDelete(hotel._id, hotel.hotelName)}
        className="p-1.5 rounded hover:bg-red-100 text-red-600"
        title="Delete"
      >
        <FiTrash size={16} />
      </button>
    </div>
  );

  const statusBadgeColors: Record<string, string> = {
    pending_approval: "bg-yellow-100 text-yellow-800",
    published: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
    suspended: "bg-orange-100 text-orange-800",
    archived: "bg-gray-100 text-gray-800",
    draft: "bg-blue-100 text-blue-800",
  };

  const appStatusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    declined: "bg-red-100 text-red-800",
  };

  const listingStatuses = ["all", "pending_approval", "published", "rejected", "suspended", "archived", "draft"];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Manage Hotels"
        subtitle="View, edit, and moderate all hotel listings"
        icon={FiHome}
        action={
          <button
            onClick={() => window.open("/hotelregistration", "_blank")}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700"
          >
            <FiPlus size={18} /> Add Hotel
          </button>
        }
      />

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <FiFilter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search hotels..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-w-[180px]"
        >
          {listingStatuses.map((s) => (
            <option key={s} value={s}>{s === "all" ? "All Statuses" : s.replace("_", " ")}</option>
          ))}
        </select>
      </div>

      <Admin_DataTable
        data={hotels}
        columns={columns}
        loading={loading}
        emptyMessage="No hotels found"
        renderActions={renderActions}
        customCellRenderers={{
          listingStatus: (v: string) => (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeColors[v] || "bg-gray-100 text-gray-800"}`}>
              {v.replace("_", " ")}
            </span>
          ),
          applicationStatus: (v: string) => (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${appStatusColors[v] || "bg-gray-100 text-gray-800"}`}>
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

export default Admin_Hotels;