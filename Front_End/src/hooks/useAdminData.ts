import { useState, useEffect, useCallback } from "react";
import { toast } from "react-toastify";
import { adminApi, type Bus, type User, type Vehicle, type Booking, type RefundRequest, type Vendor } from "../api";

interface DashboardItem {
  name: string;
  count: number;
  color: string;
}

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

const useAdminData = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorApplications, setVendorApplications] = useState<Vendor[]>([]);
  const [admins, setAdmins] = useState<User[]>([]);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [refundRequests, setRefundRequests] = useState<RefundRequest[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [hotelApplications, setHotelApplications] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.getDashboard();
      setUsers(data.users || []);

      const allVendors = data.vendors || [];
      const isApprovedVendor = (v: Vendor) =>
        v.applicationStatus === "approved" || (!v.applicationStatus && v.isActive);
      setVendors(allVendors.filter(isApprovedVendor));
      setVendorApplications(
        allVendors.filter(
          (v) => v.applicationStatus === "pending" || (!v.applicationStatus && !v.isActive)
        )
      );

      setAdmins(data.admins || []);
      setBuses(data.buses || []);
      setVehicles(data.vehicles || []);
      setBookings(data.bookings || []);
      setRefundRequests(data.refundRequests || []);

      // Fetch hotel data separately
      try {
        const [hotelsRes, pendingRes] = await Promise.all([
          adminApi.getHotels({ limit: 100 }),
          adminApi.getPendingHotelListings(),
        ]);
        setHotels(hotelsRes.hotels || []);
        setHotelApplications(pendingRes.hotels || []);
      } catch (hotelError) {
        console.warn("Failed to load hotel data:", hotelError);
        setHotels([]);
        setHotelApplications([]);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to load data. Please check your connection and try again.");
      setError("Failed to load data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleVendorStatus = async (vendorId: string) => {
    const toastId = toast.loading("Updating vendor status...");
    try {
      const data = await adminApi.toggleVendor(vendorId);
      toast.update(toastId, {
        render:
          (data as { message?: string }).message ||
          "Vendor status updated successfully",
        type: "success",
        isLoading: false,
      });
      fetchData();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, {
        render:
          axiosErr.response?.data?.message || "Failed to update vendor status",
        type: "error",
        isLoading: false,
      });
    }
  };

  const approveVendor = async (vendorId: string) => {
    const toastId = toast.loading("Approving vendor application...");
    try {
      const data = await adminApi.approveVendor(vendorId);
      toast.update(toastId, {
        render:
          (data as { message?: string }).message ||
          "Vendor approved successfully",
        type: "success",
        isLoading: false,
      });
      fetchData();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, {
        render:
          axiosErr.response?.data?.message || "Failed to approve vendor",
        type: "error",
        isLoading: false,
      });
    }
  };

  const declineVendor = async (vendorId: string) => {
    const toastId = toast.loading("Declining vendor application...");
    try {
      const data = await adminApi.declineVendor(vendorId);
      toast.update(toastId, {
        render:
          (data as { message?: string }).message ||
          "Vendor application declined",
        type: "success",
        isLoading: false,
      });
      fetchData();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, {
        render:
          axiosErr.response?.data?.message || "Failed to decline vendor",
        type: "error",
        isLoading: false,
      });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      const data = await adminApi.deleteUser(userId);
      toast.success((data as { message?: string }).message || "User deleted successfully");
      fetchData();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.error(axiosErr.response?.data?.message || "Failed to delete user");
    }
  };

  const handleDeleteVendor = async (vendorId: string) => {
    try {
      const data = await adminApi.deleteVendor(vendorId);
      toast.success((data as { message?: string }).message || "Vendor deleted successfully");
      fetchData();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.error(axiosErr.response?.data?.message || "Failed to delete vendor");
    }
  };

  const handleDeleteAdmin = async (adminId: string) => {
    try {
      const data = await adminApi.deleteAdmin(adminId);
      toast.success((data as { message?: string }).message || "Admin deleted successfully");
      fetchData();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.error(axiosErr.response?.data?.message || "Failed to delete admin");
    }
  };

  // Hotel management functions
  const approveHotelListing = async (hotelId: string, reason?: string) => {
    const toastId = toast.loading("Approving hotel listing...");
    try {
      const data = await adminApi.approveHotelListing(hotelId, reason);
      toast.update(toastId, {
        render: (data as { message?: string }).message || "Hotel listing approved",
        type: "success",
        isLoading: false,
      });
      fetchData();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, {
        render: axiosErr.response?.data?.message || "Failed to approve",
        type: "error",
        isLoading: false,
      });
    }
  };

  const rejectHotelListing = async (hotelId: string, reason: string) => {
    const toastId = toast.loading("Rejecting hotel listing...");
    try {
      const data = await adminApi.rejectHotelListing(hotelId, reason);
      toast.update(toastId, {
        render: (data as { message?: string }).message || "Hotel listing rejected",
        type: "success",
        isLoading: false,
      });
      fetchData();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, {
        render: axiosErr.response?.data?.message || "Failed to reject",
        type: "error",
        isLoading: false,
      });
    }
  };

  const suspendHotelListing = async (hotelId: string, reason?: string) => {
    const toastId = toast.loading("Suspending hotel listing...");
    try {
      const data = await adminApi.suspendHotelListing(hotelId, reason);
      toast.update(toastId, {
        render: (data as { message?: string }).message || "Hotel listing suspended",
        type: "success",
        isLoading: false,
      });
      fetchData();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, {
        render: axiosErr.response?.data?.message || "Failed to suspend",
        type: "error",
        isLoading: false,
      });
    }
  };

  const reinstateHotelListing = async (hotelId: string, reason?: string) => {
    const toastId = toast.loading("Reinstating hotel listing...");
    try {
      const data = await adminApi.reinstateHotelListing(hotelId, reason);
      toast.update(toastId, {
        render: (data as { message?: string }).message || "Hotel listing reinstated",
        type: "success",
        isLoading: false,
      });
      fetchData();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, {
        render: axiosErr.response?.data?.message || "Failed to reinstate",
        type: "error",
        isLoading: false,
      });
    }
  };

  const archiveHotelListing = async (hotelId: string, reason?: string) => {
    const toastId = toast.loading("Archiving hotel listing...");
    try {
      const data = await adminApi.archiveHotelListing(hotelId, reason);
      toast.update(toastId, {
        render: (data as { message?: string }).message || "Hotel listing archived",
        type: "success",
        isLoading: false,
      });
      fetchData();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, {
        render: axiosErr.response?.data?.message || "Failed to archive",
        type: "error",
        isLoading: false,
      });
    }
  };

  const activateHotelAccount = async (hotelId: string, isActive: boolean) => {
    const toastId = toast.loading(isActive ? "Activating account..." : "Deactivating account...");
    try {
      const data = await adminApi.activateHotelAccount(hotelId, isActive);
      toast.update(toastId, {
        render: (data as { message?: string }).message || (isActive ? "Account activated" : "Account deactivated"),
        type: "success",
        isLoading: false,
      });
      fetchData();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.update(toastId, {
        render: axiosErr.response?.data?.message || "Failed",
        type: "error",
        isLoading: false,
      });
    }
  };

  const handleDeleteHotel = async (hotelId: string) => {
    try {
      const data = await adminApi.deleteHotel(hotelId);
      toast.success((data as { message?: string }).message || "Hotel deleted successfully");
      fetchData();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.error(axiosErr.response?.data?.message || "Failed to delete hotel");
    }
  };

  const dashboardData: DashboardItem[] = [
    { name: "Users", count: users.length, color: "#3B82F6" },
    { name: "Vendors", count: vendors.length, color: "#10B981" },
    { name: "Applications", count: vendorApplications.length, color: "#F59E0B" },
    { name: "Admins", count: admins.length, color: "#06B6D4" },
    { name: "Buses", count: buses.length, color: "#8B5CF6" },
    { name: "Vehicles", count: vehicles.length, color: "#EF4444" },
    { name: "Bookings", count: bookings.length, color: "#EC4899" },
    { name: "Refunds", count: refundRequests.length, color: "#F97316" },
    { name: "Hotels", count: hotels.length, color: "#EC4899" },
    { name: "Hotel Apps", count: hotelApplications.length, color: "#F59E0B" },
  ];

  return {
    users,
    vendors,
    vendorApplications,
    admins,
    buses,
    vehicles,
    bookings,
    refundRequests,
    hotels,
    hotelApplications,
    dashboardData,
    loading,
    error,
    fetchData,
    handleDeleteUser,
    handleDeleteVendor,
    handleDeleteAdmin,
    toggleVendorStatus,
    approveVendor,
    declineVendor,
    // Hotel functions
    approveHotelListing,
    rejectHotelListing,
    suspendHotelListing,
    reinstateHotelListing,
    archiveHotelListing,
    activateHotelAccount,
    handleDeleteHotel,
  };
};

export default useAdminData;