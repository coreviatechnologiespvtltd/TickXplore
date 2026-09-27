import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactElement,
} from "react";
import { toast } from "react-toastify";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  FiMenu,
  FiX,
  FiGrid,
  FiTruck,
  FiList,
  FiBookOpen,
  FiBell,
  FiRefreshCw,
  FiLogOut,
  FiUser,
  FiPlusCircle,
} from "react-icons/fi";
import {
  vendorApi,
  notificationsApi,
  type Booking,
  type BookingRef,
  type Bus,
  type Notification,
  type Vehicle,
} from "../../api";
import { earningsOf, formatMoney } from "../../utils/format";
import LogoutConfirmModal from "../../Component/LogoutConfirmModal";
import ScrollToTopButton from "../../Component/ScrollToTopButton";

interface VendorData {
  vehicles: Vehicle[];
  buses: Bus[];
  bookings: Booking[];
  loading: boolean;
  error: string;
  sidebarOpen: boolean;
}

interface SummaryCard {
  name: string;
  count: number | string;
  color: string;
}

interface BookingStatusItem {
  name: string;
  value: number;
  color: string;
}

interface DepartureItem {
  id: string;
  name: string;
  type: "Bus" | "Vehicle";
  pickup?: string;
  drop?: string;
  when: string;
}

interface VendorOutletContext {
  vehicles: Vehicle[];
  buses: Bus[];
  bookings: Booking[];
  loading: boolean;
  error: string;
  fetchData: () => void;
}

const NAV_SECTIONS: { title: string; links: { label: string; path: string; icon: ReactElement }[] }[] = [
  {
    title: "Overview",
    links: [{ label: "Dashboard", path: "/VendorDashboard", icon: <FiGrid /> }],
  },
  {
    title: "Transport",
    links: [
      { label: "Vehicles", path: "/VendorDashboard/vehicles", icon: <FiTruck /> },
      { label: "Buses", path: "/VendorDashboard/buses", icon: <FiList /> },
    ],
  },
  {
    title: "Operations",
    links: [
      { label: "Bookings", path: "/VendorDashboard/bookings", icon: <FiBookOpen /> },
      { label: "Book Ticket", path: "/VendorDashboard/book-ticket", icon: <FiPlusCircle /> },
    ],
  },
];

const statusPill = (status: string) =>
  status === "Booked"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
    : status === "Pending"
    ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
    : "border-rose-500/30 bg-rose-500/10 text-rose-600";

const VendorDashboard = () => {
  const [data, setData] = useState<VendorData>({
    vehicles: [],
    buses: [],
    bookings: [],
    loading: true,
    error: "",
    sidebarOpen: false,
  });
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const vendorId = localStorage.getItem("vendorId") || "";
  const vendorName = localStorage.getItem("userName") || "";
  const initials = vendorName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  const location = useLocation();
  const navigate = useNavigate();
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const fetchData = useCallback(async () => {
    try {
      setData((prev) => ({ ...prev, loading: true, error: "" }));

      const result = await vendorApi.getDashboard(vendorId);

      const newData: VendorData = {
        vehicles: result.vehicles || [],
        buses: result.buses || [],
        bookings: result.bookings || [],
        loading: false,
        error: "",
        sidebarOpen: false,
      };

      setData(newData);
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load data.", { position: "top-right", autoClose: 5000 });
      setData((prev) => ({
        ...prev,
        error: "Failed to load data.",
        loading: false,
      }));
    }
  }, [vendorId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ---- notifications ---- */
  const fetchNotifications = useCallback(async () => {
    const role = localStorage.getItem("userRole");
    if (!vendorId || !role) return;
    try {
      const res = await notificationsApi.get(role, vendorId);
      setNotifications(res.data || []);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    }
  }, [vendorId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markNotificationRead = async (id: string) => {
    try {
      await notificationsApi.markRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, isRead: true } : n))
      );
    } catch (error) {
      console.error("Error marking notification read:", error);
    }
  };

  /* ---- outside click + Escape handling ---- */
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node))
        setNotifOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node))
        setUserOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNotifOpen(false);
        setUserOpen(false);
        setData((prev) => ({ ...prev, sidebarOpen: false }));
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const confirmLogout = () => {
    toast.dismiss();
    localStorage.clear();
    window.dispatchEvent(new Event("storageUpdate"));
    toast.success("Logged out successfully!");
    navigate("/sign-in");
  };

  const toggleSidebar = () =>
    setData((prev) => ({ ...prev, sidebarOpen: !prev.sidebarOpen }));

  /* ---- derived dashboard data ---- */
  const totalEarnings = useMemo(
    () =>
      data.bookings
        .filter((b) => b.status === "Booked")
        .reduce((sum, b) => sum + earningsOf(b), 0),
    [data.bookings]
  );

  const summaryCards: SummaryCard[] = [
    { name: "Vehicles", count: data.vehicles.length, color: "#3B82F6" },
    { name: "Buses", count: data.buses.length, color: "#10B981" },
    { name: "Bookings", count: data.bookings.length, color: "#F59E0B" },
    { name: "Earnings", count: formatMoney(totalEarnings), color: "#6366F1" },
  ];

  const colorMap: Record<string, string> = {
    Booked: "#10B981",
    Pending: "#F59E0B",
    Cancelled: "#EF4444",
  };

  const bookingsByStatus: BookingStatusItem[] = ["Booked", "Pending", "Cancelled"].map(
    (status) => ({
      name: status,
      value: data.bookings.filter((b) => b.status === status).length,
      color: colorMap[status],
    })
  );

  const hasBookedBookings = data.bookings.some((b) => b.status === "Booked");

  const earningsTrend = useMemo(() => {
    const byDay = new Map<string, number>();
    data.bookings.forEach((b) => {
      if (b.status === "Booked" && b.createdAt) {
        const label = new Date(b.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        byDay.set(label, (byDay.get(label) || 0) + earningsOf(b));
      }
    });
    const days: { date: string; earnings: number }[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      days.push({ date: label, earnings: byDay.get(label) || 0 });
    }
    return days;
  }, [data.bookings]);

  const upcomingDepartures = useMemo(() => {
    const now = Date.now();
    const busItems: DepartureItem[] = data.buses
      .filter((b) => b.takeOffDate && new Date(b.takeOffDate).getTime() > now)
      .map((b) => ({
        id: b._id,
        name: b.name || b.busName || "Bus",
        type: "Bus" as const,
        pickup: b.pickupPoint,
        drop: b.dropPoint,
        when: b.takeOffDate as string,
      }));
    const vehicleItems: DepartureItem[] = data.vehicles
      .filter((v) => v.takeOffDate && new Date(v.takeOffDate).getTime() > now)
      .map((v) => ({
        id: v._id,
        name: v.name,
        type: "Vehicle" as const,
        pickup: v.pickupPoint,
        drop: v.dropPoint,
        when: v.takeOffDate as string,
      }));
    return [...busItems, ...vehicleItems]
      .sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime())
      .slice(0, 5);
  }, [data.buses, data.vehicles]);

  const recentBookings = useMemo(
    () =>
      [...data.bookings]
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
        .slice(0, 5),
    [data.bookings]
  );

  const isDataEmpty =
    data.vehicles.length === 0 && data.buses.length === 0 && data.bookings.length === 0;

  const crumbs = location.pathname.split("/").filter(Boolean);
  const breadcrumb =
    crumbs.length > 1
      ? crumbs[1].charAt(0).toUpperCase() + crumbs[1].slice(1)
      : "";

  const context: VendorOutletContext = {
    vehicles: data.vehicles,
    buses: data.buses,
    bookings: data.bookings,
    loading: data.loading,
    error: data.error,
    fetchData,
  };

  const isActive = (path: string) =>
    path === "/VendorDashboard"
      ? location.pathname === "/VendorDashboard"
      : location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <div className="flex h-screen flex-col bg-slate-200">
      <header className="relative flex h-16 shrink-0 items-center justify-between gap-3 border-b-2 border-indigo-600 bg-white px-4 text-gray-900 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={toggleSidebar}
            className="rounded-md bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 lg:hidden"
            aria-label="Toggle menu"
          >
            {data.sidebarOpen ? <FiX size={22} /> : <FiMenu size={22} />}
          </button>
        </div>

        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-wide md:text-xl">
          Vendor Portal
        </h1>

        <div className="ml-auto flex items-center gap-2">
          {/* Notifications */}
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setNotifOpen((o) => !o)}
              className="relative rounded-md bg-slate-100 p-2 text-slate-700 hover:bg-slate-200"
              aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
              aria-expanded={notifOpen}
            >
              <FiBell size={20} />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-100 bg-white text-slate-700 shadow-card-lg">
                <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
                  Notifications
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-slate-400">
                      No notifications yet.
                    </p>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n._id}
                        onClick={() => markNotificationRead(n._id)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                          n.isRead ? "opacity-60" : ""
                        }`}
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                            n.isRead ? "bg-slate-200" : "bg-indigo-500"
                          }`}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm text-slate-700">{n.message}</span>
                          {n.createdAt && (
                            <span className="mt-0.5 block text-xs text-slate-400">
                              {new Date(n.createdAt).toLocaleString()}
                            </span>
                          )}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User menu */}
          <div ref={userRef} className="relative">
            <button
              onClick={() => setUserOpen((o) => !o)}
              className="flex items-center gap-2 rounded-full p-1 pr-2 transition-colors hover:bg-slate-100"
              aria-label="Account menu"
              aria-expanded={userOpen}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                {initials || "V"}
              </span>
              <span className="hidden text-sm font-medium text-slate-700 sm:block">
                {vendorName || "Vendor"}
              </span>
            </button>
            {userOpen && (
              <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-100 bg-white text-slate-700 shadow-card-lg">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {vendorName || "Vendor"}
                  </p>
                  <p className="text-xs text-slate-500">Vendor account</p>
                </div>
                <Link
                  to="/profile"
                  onClick={() => setUserOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-slate-50"
                >
                  <FiUser />
                  My Profile
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-rose-600 transition-colors hover:bg-rose-50"
                >
                  <FiLogOut />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {data.sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={toggleSidebar}
            aria-hidden="true"
          />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-indigo-100 bg-indigo-50 text-slate-700 transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
            data.sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <nav className="w-full p-4">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title} className="mb-4 last:mb-0">
                <p className="mb-1.5 px-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {section.title}
                </p>
                <ul className="space-y-1">
                  {section.links.map(({ label, path, icon }) => (
                    <li key={path}>
                      <Link
                        to={path}
                        onClick={() =>
                          setData((prev) => ({ ...prev, sidebarOpen: false }))
                        }
                        className={`flex items-center gap-3 rounded-lg border-l-4 px-4 py-2.5 text-sm font-medium transition-colors ${
                          isActive(path)
                            ? "border-indigo-600 bg-indigo-600 font-semibold text-white"
                            : "border-transparent text-slate-600 hover:bg-indigo-100/60 hover:text-indigo-900"
                        }`}
                      >
                        <span className="inline-flex">{icon}</span>
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
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
          {data.loading ? (
            <div className="space-y-8">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/70" />
                ))}
              </div>
              <div className="grid grid-cols-1 gap-6 md:gap-8 lg:grid-cols-2">
                <div className="h-80 animate-pulse rounded-2xl bg-white/70" />
                <div className="h-80 animate-pulse rounded-2xl bg-white/70" />
              </div>
            </div>
          ) : (
            <>
              {data.error && (
                <div className="mb-6 flex flex-col items-center justify-between gap-4 rounded-lg bg-rose-100 p-4 text-rose-700 sm:flex-row">
                  <p>{data.error}</p>
                  <button
                    onClick={fetchData}
                    className="rounded-md bg-rose-600 px-4 py-2 text-white transition-colors hover:bg-rose-700"
                  >
                    Retry
                  </button>
                </div>
              )}

              {breadcrumb && (
                <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500">
                  <Link to="/VendorDashboard" className="hover:text-indigo-600">
                    Dashboard
                  </Link>
                  <span className="mx-2">/</span>
                  <span className="font-medium text-slate-700">{breadcrumb}</span>
                </nav>
              )}

              <Outlet context={context} />

              {location.pathname === "/VendorDashboard" && (
                <div className="space-y-8">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900 md:text-2xl">
                        Welcome back, {vendorName.split(" ")[0] || "Vendor"}
                      </h2>
                      <p className="text-sm text-slate-500">
                        {new Date().toLocaleDateString("en-US", {
                          weekday: "long",
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                        {lastUpdated &&
                          ` · Last updated ${lastUpdated.toLocaleTimeString()}`}
                      </p>
                    </div>
                    <button
                      onClick={fetchData}
                      className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50"
                    >
                      <FiRefreshCw size={16} />
                      Refresh
                    </button>
                  </div>

                  {isDataEmpty ? (
                    <div className="rounded-2xl bg-white p-8 text-center shadow-card md:p-12">
                      <h3 className="text-lg font-semibold text-slate-900">
                        Get started with your vendor portal
                      </h3>
                      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                        Add a vehicle or a bus to start receiving bookings and track
                        your earnings right here.
                      </p>
                      <div className="mt-6 flex flex-wrap justify-center gap-3">
                        <Link
                          to="/VendorDashboard/vehicles"
                          className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                        >
                          Add Vehicle
                        </Link>
                        <Link
                          to="/VendorDashboard/buses"
                          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          Add Bus
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-4">
                        {summaryCards.map((item) => (
                          <div
                            key={item.name}
                            className="rounded-2xl bg-white p-4 shadow-card transition-all hover:shadow-card-lg md:p-6"
                            style={{ borderLeft: `4px solid ${item.color}` }}
                          >
                            <h3 className="text-base font-semibold text-gray-700 md:text-lg">
                              {item.name}
                            </h3>
                            <p
                              className="mt-2 text-2xl font-bold md:text-3xl"
                              style={{ color: item.color }}
                            >
                              {item.count}
                            </p>
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <Link
                          to="/VendorDashboard/book-ticket"
                          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-700 p-5 text-white shadow-card transition-all hover:shadow-card-lg"
                        >
                          <div>
                            <h3 className="text-lg font-bold md:text-xl">Book a Ticket</h3>
                            <p className="mt-1 text-sm text-indigo-100">
                              Quickly create a booking for a walk-in customer — bus seats or a whole vehicle.
                            </p>
                          </div>
                          <span className="mt-4 inline-flex w-fit items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-indigo-700 transition-transform group-hover:translate-x-0.5">
                            <FiPlusCircle /> Start booking
                          </span>
                        </Link>
                        <Link
                          to="/VendorDashboard/bookings"
                          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 to-emerald-700 p-5 text-white shadow-card transition-all hover:shadow-card-lg"
                        >
                          <div>
                            <h3 className="text-lg font-bold md:text-xl">Confirm Payments</h3>
                            <p className="mt-1 text-sm text-emerald-100">
                              Review pending Cash on Visit bookings and settle them from the Bookings section.
                            </p>
                          </div>
                          <span className="mt-4 inline-flex w-fit items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-emerald-700 transition-transform group-hover:translate-x-0.5">
                            Go to bookings
                          </span>
                        </Link>
                        <Link
                          to="/VendorDashboard/buses"
                          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 to-slate-700 p-5 text-white shadow-card transition-all hover:shadow-card-lg"
                        >
                          <div>
                            <h3 className="text-lg font-bold md:text-xl">Manage Fleet</h3>
                            <p className="mt-1 text-sm text-slate-300">
                              Add or update your buses and vehicles so new bookings always go through.
                            </p>
                          </div>
                          <span className="mt-4 inline-flex w-fit items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-transform group-hover:translate-x-0.5">
                            Manage fleet
                          </span>
                        </Link>
                      </div>

                      <div className="grid grid-cols-1 gap-6 md:gap-8 lg:grid-cols-2">
                        <div className="rounded-2xl bg-white p-4 shadow-card md:p-6">
                          <h2 className="mb-4 text-lg font-semibold md:text-xl">
                            Earnings — Last 14 Days
                          </h2>
                          <div className="h-64 md:h-80">
                            {hasBookedBookings ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart
                                  data={earningsTrend}
                                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                                >
                                  <defs>
                                    <linearGradient
                                      id="earnGrad"
                                      x1="0"
                                      y1="0"
                                      x2="0"
                                      y2="1"
                                    >
                                      <stop
                                        offset="5%"
                                        stopColor="#6366F1"
                                        stopOpacity={0.25}
                                      />
                                      <stop
                                        offset="95%"
                                        stopColor="#6366F1"
                                        stopOpacity={0}
                                      />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis dataKey="date" />
                                  <YAxis width={70} />
                                  <Tooltip
                                    formatter={(value) =>
                                      formatMoney(Number(value))
                                    }
                                  />
                                  <Area
                                    type="monotone"
                                    dataKey="earnings"
                                    name="Earnings"
                                    stroke="#6366F1"
                                    strokeWidth={2}
                                    fill="url(#earnGrad)"
                                  />
                                </AreaChart>
                              </ResponsiveContainer>
                            ) : (
                              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                                No earnings recorded yet.
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-4 shadow-card md:p-6">
                          <h2 className="mb-4 text-lg font-semibold md:text-xl">
                            Booking Status
                          </h2>
                          <div className="h-64 md:h-80">
                            {data.bookings.length > 0 ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={bookingsByStatus}
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={100}
                                    fill="#8884d8"
                                    dataKey="value"
                                    nameKey="name"
                                    label={({
                                      name,
                                      value,
                                    }: {
                                      name?: string;
                                      value?: number | string;
                                    }) =>
                                      Number(value) > 0 ? `${name}: ${value}` : ""
                                    }
                                  >
                                    {bookingsByStatus.map((entry, index) => (
                                      <Cell
                                        key={`cell-${index}`}
                                        fill={entry.color}
                                      />
                                    ))}
                                  </Pie>
                                  <Tooltip />
                                  <Legend />
                                </PieChart>
                              </ResponsiveContainer>
                            ) : (
                              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                                No bookings yet.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-6 md:gap-8 lg:grid-cols-2">
                        <div className="rounded-2xl bg-white p-4 shadow-card md:p-6">
                          <h2 className="mb-4 text-lg font-semibold md:text-xl">
                            Entity Distribution
                          </h2>
                          <div className="h-64 md:h-80">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart
                                data={summaryCards.filter(
                                  (d) => d.name !== "Earnings"
                                )}
                                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis allowDecimals={false} />
                                <Tooltip />
                                <Legend />
                                <Bar
                                  dataKey="count"
                                  name="Total Count"
                                  fill="#6366F1"
                                  radius={[4, 4, 0, 0]}
                                />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-4 shadow-card md:p-6">
                          <h2 className="mb-4 text-lg font-semibold md:text-xl">
                            Upcoming Departures
                          </h2>
                          {upcomingDepartures.length === 0 ? (
                            <div className="flex h-64 items-center justify-center text-sm text-slate-400">
                              No upcoming departures scheduled.
                            </div>
                          ) : (
                            <ul className="space-y-3">
                              {upcomingDepartures.map((departure) => (
                                <li
                                  key={departure.id}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-slate-900">
                                      {departure.name}
                                      <span className="ml-2 text-xs font-semibold uppercase text-slate-400">
                                        {departure.type}
                                      </span>
                                    </p>
                                    <p className="truncate text-xs text-slate-500">
                                      {departure.pickup || "—"} →{" "}
                                      {departure.drop || "—"}
                                    </p>
                                  </div>
                                  <div className="shrink-0 text-right">
                                    <p className="text-xs font-semibold text-indigo-600">
                                      {new Date(departure.when).toLocaleDateString(
                                        undefined,
                                        { month: "short", day: "numeric" }
                                      )}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                      {new Date(departure.when).toLocaleTimeString(
                                        undefined,
                                        { hour: "2-digit", minute: "2-digit" }
                                      )}
                                    </p>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-white p-4 shadow-card md:p-6">
                        <div className="mb-4 flex items-center justify-between">
                          <h2 className="text-lg font-semibold md:text-xl">
                            Recent Bookings
                          </h2>
                          <Link
                            to="/VendorDashboard/bookings"
                            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                          >
                            View all
                          </Link>
                        </div>
                        {recentBookings.length === 0 ? (
                          <div className="flex h-32 items-center justify-center text-sm text-slate-400">
                            No bookings yet.
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                              <thead>
                                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                                  <th scope="col" className="px-3 py-2 font-semibold">
                                    Customer
                                  </th>
                                  <th scope="col" className="px-3 py-2 font-semibold">
                                    Transport
                                  </th>
                                  <th scope="col" className="px-3 py-2 font-semibold">
                                    Seats
                                  </th>
                                  <th
                                    scope="col"
                                    className="px-3 py-2 text-right font-semibold"
                                  >
                                    Price
                                  </th>
                                  <th scope="col" className="px-3 py-2 font-semibold">
                                    Status
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {recentBookings.map((booking) => {
                                  const user = booking.userId as
                                    | { name?: string }
                                    | undefined;
                                  const busRef = booking.busId as
                                    | BookingRef
                                    | undefined;
                                  const vehicleRef = booking.vehicleId as
                                    | BookingRef
                                    | undefined;
                                  return (
                                    <tr key={booking._id}>
                                      <td className="px-3 py-3 font-medium text-gray-900">
                                        {user?.name || booking.customerName || "N/A"}
                                      </td>
                                      <td className="px-3 py-3 text-gray-700">
                                        {busRef?.name || vehicleRef?.name || "N/A"}
                                      </td>
                                      <td className="px-3 py-3 text-gray-700">
                                        {booking.selectedSeats?.join(", ") || "—"}
                                      </td>
                                      <td className="px-3 py-3 text-right font-semibold text-indigo-700">
                                        {formatMoney(booking.totalPrice)}
                                      </td>
                                      <td className="px-3 py-3">
                                        <span
                                          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusPill(
                                            booking.status || ""
                                          )}`}
                                        >
                                          {booking.status || "Unknown"}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
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

export default VendorDashboard;