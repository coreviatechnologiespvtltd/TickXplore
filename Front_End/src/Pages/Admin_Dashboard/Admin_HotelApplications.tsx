import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FiCheck, FiX, FiEye, FiLoader, FiFilter, FiAlertCircle } from "react-icons/fi";
import { toast } from "react-toastify";
import Admin_DataTable from "../../Component/Admin Component/Admin_DataTable";
import AdminPageHeader from "../../Component/Admin Component/AdminPageHeader";
import { adminApi } from "../../api";

interface HotelApplication {
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
  readiness?: unknown;
}

interface OutletContext {
  fetchData: () => void;
  approveHotelListing: (id: string, reason?: string) => void;
  rejectHotelListing: (id: string, reason: string) => void;
  activateHotelAccount: (id: string, isActive: boolean) => void;
}

const columns = [
  { key: "hotelName", label: "Hotel Name" },
  { key: "hotelId", label: "Hotel ID" },
  { key: "email", label: "Email" },
  { key: "city", label: "City" },
  { key: "type", label: "Type" },
  { key: "starRating", label: "Stars", render: (v: number) => "⭐".repeat(v || 0) },
  { key: "listingStatus", label: "Listing Status", badge: true },
  { key: "applicationStatus", label: "Account Status", badge: true },
  { key: "submittedAt", label: "Submitted", render: (v: string) => v ? new Date(v).toLocaleDateString() : "—" },
  { key: "createdAt", label: "Registered", render: (v: string) => new Date(v).toLocaleDateString() },
];

const Admin_HotelApplications = () => {
  const { fetchData, approveHotelListing, rejectHotelListing, activateHotelAccount } = useOutletContext<OutletContext>();
  const [applications, setApplications] = useState<HotelApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"pending" | "approved" | "declined" | "all">("pending");

  const fetchApplications = async () => {
    setLoading(true);
    try {
      const res = await adminApi.getPendingHotelListings();
      setApplications(res.hotels || []);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load hotel applications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplications();
  }, []);

  const handleApprove = async (hotelId: string) => {
    const toastId = toast.loading("Approving hotel listing...");
    try {
      await adminApi.approveHotelListing(hotelId);
      toast.update(toastId, { render: "Hotel listing approved & published", type: "success", isLoading: false });
      fetchApplications();
      fetchData();
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, { render: axiosErr.response?.data?.message || "Failed to approve", type: "error", isLoading: false });
    }
  };

  const handleReject = async (hotelId: string) => {
    const reason = prompt("Enter rejection reason:");
    if (!reason) return;
    const toastId = toast.loading("Rejecting hotel listing...");
    try {
      await adminApi.rejectHotelListing(hotelId, reason);
      toast.update(toastId, { render: "Hotel listing rejected", type: "success", isLoading: false });
      fetchApplications();
      fetchData();
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, { render: axiosErr.response?.data?.message || "Failed to reject", type: "error", isLoading: false });
    }
  };

  const handleActivate = async (hotelId: string, activate: boolean) => {
    const toastId = toast.loading(activate ? "Activating account..." : "Deactivating account...");
    try {
      await adminApi.activateHotelAccount(hotelId, activate);
      toast.update(toastId, { render: activate ? "Account activated" : "Account deactivated", type: "success", isLoading: false });
      fetchApplications();
      fetchData();
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, { render: axiosErr.response?.data?.message || "Failed", type: "error", isLoading: false });
    }
  };

  const handleView = (hotel: HotelApplication) => {
    window.open(`/admin/hotels/${hotel._id}`, "_blank");
  };

  const renderActions = (hotel: HotelApplication) => (
    <div className="flex items-center gap-2">
      <button
        onClick={() => handleView(hotel)}
        className="p-1.5 rounded hover:bg-blue-100 text-blue-600"
        title="View Details"
      >
        <FiEye size={16} />
      </button>
      {hotel.listingStatus === "pending_approval" && (
        <>
          <button
            onClick={() => handleApprove(hotel._id)}
            className="p-1.5 rounded hover:bg-green-100 text-green-600"
            title="Approve Listing"
          >
            <FiCheck size={16} />
          </button>
          <button
            onClick={() => handleReject(hotel._id)}
            className="p-1.5 rounded hover:bg-red-100 text-red-600"
            title="Reject Listing"
          >
            <FiX size={16} />
          </button>
        </>
      )}
      <button
        onClick={() => handleActivate(hotel._id, !hotel.isActive)}
        className={`p-1.5 rounded ${hotel.isActive ? "hover:bg-orange-100 text-orange-600" : "hover:bg-green-100 text-green-600"}`}
        title={hotel.isActive ? "Deactivate Account" : "Activate Account"}
      >
        {hotel.isActive ? <FiAlertCircle size={16} /> : <FiCheck size={16} />}
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

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Hotel Applications"
        subtitle="Review and moderate hotel listing submissions"
        icon={FiFilter}
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {(["all", "pending", "approved", "declined"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <Admin_DataTable
        data={applications}
        columns={columns}
        loading={loading}
        emptyMessage="No hotel applications found"
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
      />
    </div>
  );
};

export default Admin_HotelApplications;