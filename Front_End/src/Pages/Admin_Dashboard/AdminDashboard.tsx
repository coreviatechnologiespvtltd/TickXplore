import { useState, useRef, type ReactElement } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FiMenu,
  FiX,
  FiGrid,
  FiUsers,
  FiBriefcase,
  FiUserCheck,
  FiList,
  FiTruck,
  FiBookOpen,
  FiRefreshCw,
  FiUserPlus,
  FiLogOut,
  FiPlusCircle,
  FiFileText,
  FiHome,
  FiCalendar,
  FiChevronDown,
  FiChevronRight,
} from "react-icons/fi";
import useAdminData from "../../hooks/useAdminData";
import LogoutConfirmModal from "../../Component/LogoutConfirmModal";
import ScrollToTopButton from "../../Component/ScrollToTopButton";
import type { Bus, Booking, RefundRequest, User, Vendor, Vehicle } from "../../api";

export interface AdminOutletContext {
  users: User[];
  vendors: Vendor[];
  vendorApplications: Vendor[];
  admins: User[];
  buses: Bus[];
  vehicles: Vehicle[];
  bookings: Booking[];
  refundRequests: RefundRequest[];
  hotels: {
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
  }[];
  hotelApplications: {
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
  }[];
  dashboardData: { name: string; count: number; color: string }[];
  handleDeleteUser: (id: string) => void;
  handleDeleteVendor: (id: string) => void;
  handleDeleteAdmin: (id: string) => void;
  toggleVendorStatus: (id: string) => void;
  approveVendor: (id: string) => void;
  declineVendor: (id: string) => void;
  // Hotel functions
  approveHotelListing: (id: string, reason?: string) => void;
  rejectHotelListing: (id: string, reason: string) => void;
  suspendHotelListing: (id: string, reason?: string) => void;
  reinstateHotelListing: (id: string, reason?: string) => void;
  archiveHotelListing: (id: string, reason?: string) => void;
  activateHotelAccount: (id: string, isActive: boolean) => void;
  handleDeleteHotel: (id: string) => void;
  loading: boolean;
  error: string;
  fetchData: () => void;
}

interface NavItem {
  label: string;
  path: string;
  icon: ReactElement;
}

interface NavGroup {
  label: string;
  icon: ReactElement;
  children: NavItem[];
}

const SINGLE_ITEMS: { label: string; path: string; icon: ReactElement }[] = [
  { label: "Dashboard", path: "", icon: <FiGrid /> },
  { label: "Refunds", path: "refunds", icon: <FiRefreshCw /> },
];

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Users",
    icon: <FiUsers />,
    children: [
      { label: "Users", path: "users", icon: <FiUsers /> },
      { label: "Vendors", path: "vendors", icon: <FiBriefcase /> },
      { label: "Hotels", path: "hotels", icon: <FiHome /> },
      { label: "Admins", path: "admins", icon: <FiUserCheck /> },
    ],
  },
  {
    label: "Applications",
    icon: <FiFileText />,
    children: [
      { label: "Vendor Applications", path: "vendor-applications", icon: <FiUserPlus /> },
      { label: "Hotel Applications", path: "hotel-applications", icon: <FiHome /> },
    ],
  },
  {
    label: "Bus",
    icon: <FiTruck />,
    children: [
      { label: "All Buses", path: "buses", icon: <FiList /> },
      { label: "Vehicles", path: "vehicles", icon: <FiTruck /> },
      { label: "Bookings", path: "bookings", icon: <FiBookOpen /> },
      { label: "Book Ticket", path: "book-ticket", icon: <FiPlusCircle /> },
    ],
  },
  {
    label: "Hotels",
    icon: <FiHome />,
    children: [
      { label: "Manage Hotels", path: "hotels", icon: <FiHome /> },
      { label: "Hotel Bookings", path: "hotel-bookings", icon: <FiCalendar /> },
      { label: "Booked Users", path: "hotel-booked-users", icon: <FiUserCheck /> },
    ],
  },
];

const AdminDashboard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(["Users", "Bus", "Hotels"]));
  const mainRef = useRef<HTMLElement>(null);
  const userName = localStorage.getItem("userName") || "Admin";

  const confirmLogout = () => {
    toast.dismiss();
    localStorage.clear();
    toast.success("Logged out successfully!");
    navigate("/sign-in");
    window.dispatchEvent(new Event("storageUpdate"));
  };

  const {
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
    handleDeleteUser,
    handleDeleteVendor,
    handleDeleteAdmin,
    toggleVendorStatus,
    approveVendor,
    declineVendor,
    approveHotelListing,
    rejectHotelListing,
    suspendHotelListing,
    reinstateHotelListing,
    archiveHotelListing,
    activateHotelAccount,
    handleDeleteHotel,
    loading,
    error,
    fetchData,
  } = useAdminData();

  const isActive = (path: string) =>
    (path === "" && location.pathname === "/Admin_Dashboard") ||
    (path !== "" && location.pathname.startsWith(`/Admin_Dashboard/${path}`));

  const isGroupActive = (group: NavGroup) =>
    group.children.some((child) => isActive(child.path));

  const toggleGroup = (groupLabel: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupLabel)) {
        next.delete(groupLabel);
      } else {
        next.add(groupLabel);
      }
      return next;
    });
  };

  const context: AdminOutletContext = {
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
    handleDeleteUser,
    handleDeleteVendor,
    handleDeleteAdmin,
    toggleVendorStatus,
    approveVendor,
    declineVendor,
    approveHotelListing,
    rejectHotelListing,
    suspendHotelListing,
    reinstateHotelListing,
    archiveHotelListing,
    activateHotelAccount,
    handleDeleteHotel,
    loading,
    error,
    fetchData,
  };

  return (
    <div className="flex h-screen flex-col bg-slate-200">
      <header className="relative flex h-16 shrink-0 items-center justify-between gap-3 border-b-2 border-indigo-600 bg-white px-4 text-slate-900 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => setSidebarOpen((open) => !open)}
            className="rounded-md bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 lg:hidden"
            aria-label="Toggle menu"
          >
            {sidebarOpen ? <FiX size={22} /> : <FiMenu size={22} />}
          </button>

          <h1 className="truncate text-lg font-semibold tracking-wide md:text-xl">
            Admin Dashboard
          </h1>
        </div>

        <span className="min-w-0 truncate text-sm text-slate-600">
          Welcome, <span className="font-medium text-indigo-600">{userName}</span>
        </span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-indigo-100 bg-indigo-50 text-slate-700 transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <nav className="w-full p-4 flex-1 overflow-y-auto">
            <ul className="space-y-1">
              {/* Single items (Dashboard, Refunds) */}
              {SINGLE_ITEMS.map(({ label, path, icon }) => (
                <li key={path || "dashboard"}>
                  <Link
                    to={path === "" ? "/Admin_Dashboard" : `/Admin_Dashboard/${path}`}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 rounded-lg border-l-4 px-4 py-2.5 text-sm font-medium transition-colors ${
                      isActive(path)
                        ? "border-indigo-600 bg-indigo-600 font-semibold text-white"
                        : "border-transparent text-slate-600 hover:bg-indigo-100/60 hover:text-slate-900"
                    }`}
                  >
                    <span className="inline-flex">{icon}</span>
                    {label}
                  </Link>
                </li>
              ))}

              {/* Divider */}
              <li>
                <hr className="my-3 border-indigo-100" />
              </li>

              {/* Collapsible Groups */}
              {NAV_GROUPS.map((group) => (
                <li key={group.label}>
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className={`w-full flex items-center justify-between gap-3 rounded-lg border-l-4 px-4 py-2.5 text-sm font-medium transition-colors ${
                      isGroupActive(group)
                        ? "border-indigo-600 bg-indigo-600/10 font-semibold text-indigo-700"
                        : "border-transparent text-slate-600 hover:bg-indigo-100/60 hover:text-slate-900"
                    }`}
                    aria-expanded={openGroups.has(group.label)}
                  >
                    <span className="flex items-center gap-3">
                      <span className="inline-flex">{group.icon}</span>
                      {group.label}
                    </span>
                    <span className="flex-shrink-0 transition-transform duration-200">
                      {openGroups.has(group.label) ? (
                        <FiChevronDown size={16} className="text-slate-500" />
                      ) : (
                        <FiChevronRight size={16} className="text-slate-500" />
                      )}
                    </span>
                  </button>

                  <div
                    className={`overflow-hidden transition-all duration-200 ease-in-out ${
                      openGroups.has(group.label) ? "max-h-96 opacity-100 mt-1" : "max-h-0 opacity-0"
                    }`}
                    role="region"
                    aria-label={`${group.label} submenu`}
                  >
                    <ul className="ml-6 space-y-0.5 border-l border-indigo-100 pl-2">
                      {group.children.map((child) => (
                        <li key={child.path}>
                          <Link
                            to={`/Admin_Dashboard/${child.path}`}
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-3 rounded-lg border-l-4 px-3 py-2 text-sm transition-colors ${
                              isActive(child.path)
                                ? "border-indigo-600 bg-indigo-600 font-semibold text-white"
                                : "border-transparent text-slate-600 hover:bg-indigo-100/60 hover:text-slate-900"
                            }`}
                          >
                            <span className="inline-flex">{child.icon}</span>
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-auto w-full border-t border-indigo-100 p-4">
            <button
              onClick={() => setShowLogoutModal(true)}
              className="flex w-full items-center gap-3 rounded-lg border-l-4 border-transparent px-4 py-2.5 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-700"
            >
              <FiLogOut size={18} />
              Logout
            </button>
          </div>
        </aside>

        <main ref={mainRef} className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <Outlet context={context} />
        </main>

        <ScrollToTopButton scrollTarget={mainRef} />
      </div>

      <LogoutConfirmModal
        open={showLogoutModal}
        onCancel={() => setShowLogoutModal(false)}
        onConfirm={confirmLogout}
      />
    </div>
  );
};

export default AdminDashboard;