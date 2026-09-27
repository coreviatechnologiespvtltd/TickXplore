/**
 * Hotel dashboard shell.
 * ------------------------------------------------------------------
 * Owns the data every screen shares (the hotel profile, stats, room list and
 * listing status) so navigating between sections does not re-fetch four
 * endpoints each time, and so a save in one section instantly updates the
 * sidebar, the status badge and the overview.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import {
  FiBell,
  FiCalendar,
  FiCheckCircle,
  FiChevronDown,
  FiGrid,
  FiHome,
  FiLayers,
  FiLogOut,
  FiMenu,
  FiRefreshCw,
  FiShield,
  FiX,
} from "react-icons/fi";
import {
  apiErrorMessage,
  hotelApi,
  type HotelAccount,
  type HotelRoom,
  type HotelStats,
  type ListingStatusResponse,
  type ReadinessReport,
  type RoomNotification,
} from "../../api/hotel";
import LogoutConfirmModal from "../../Component/LogoutConfirmModal";
import ScrollToTopButton from "../../Component/ScrollToTopButton";
import { statusLabel } from "./helpers";
import type { HotelDashboardContextValue } from "./context";
import { Alert, Button, Spinner, StatusBadge } from "./ui";

/* ------------------------------------------------------------------ */
/* Navigation                                                           */
/* ------------------------------------------------------------------ */

const NAV_SECTIONS: Array<{
  title: string;
  links: Array<{ label: string; path: string; icon: ReactNode }>;
}> = [
  {
    title: "Overview",
    links: [
      { label: "Dashboard", path: "/hoteldashboard", icon: <FiGrid size={18} /> },
      { label: "Listing status", path: "/hoteldashboard/listing", icon: <FiCheckCircle size={18} /> },
    ],
  },
  {
    title: "Property",
    links: [
      { label: "Profile & photos", path: "/hoteldashboard/profile", icon: <FiHome size={18} /> },
      { label: "Room types", path: "/hoteldashboard/rooms", icon: <FiLayers size={18} /> },
      { label: "Availability", path: "/hoteldashboard/availability", icon: <FiCalendar size={18} /> },
      { label: "Policies", path: "/hoteldashboard/policies", icon: <FiShield size={18} /> },
    ],
  },
];

const CRUMB_LABELS: Record<string, string> = {
  "/hoteldashboard": "Dashboard",
  "/hoteldashboard/listing": "Listing status",
  "/hoteldashboard/profile": "Profile & photos",
  "/hoteldashboard/rooms": "Room types",
  "/hoteldashboard/availability": "Availability",
  "/hoteldashboard/policies": "Policies",
};

/* ------------------------------------------------------------------ */
/* Shell                                                                */
/* ------------------------------------------------------------------ */

const HotelDashboard = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const [hotel, setHotel] = useState<HotelAccount | null>(null);
  const [stats, setStats] = useState<HotelStats | null>(null);
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [listing, setListing] = useState<ListingStatusResponse | null>(null);
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [notifications, setNotifications] = useState<RoomNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [profileRes, statsRes, roomsRes, listingRes, notifRes] = await Promise.all([
        hotelApi.getProfile(),
        hotelApi.getStats(),
        hotelApi.getRooms({ includeArchived: true }),
        hotelApi.getListingStatus(),
        hotelApi.getNotifications().catch(() => ({ notifications: [] as RoomNotification[] })),
      ]);

      setHotel(profileRes.hotel);
      setStats(statsRes.stats);
      setRooms(roomsRes.rooms || []);
      setListing(listingRes);
      setNotifications(notifRes.notifications || []);
      setError("");
    } catch (loadError) {
      setError(apiErrorMessage(loadError, "Could not load your hotel dashboard."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Readiness is only needed on the overview and listing screens. */
  const refreshListing = useCallback(async () => {
    try {
      const [listingRes, readinessRes] = await Promise.all([
        hotelApi.getListingStatus(),
        hotelApi.getReadiness(),
      ]);
      setListing(listingRes);
      setReadiness(readinessRes);
    } catch (readinessError) {
      toast.error(apiErrorMessage(readinessError, "Could not load listing status."));
    }
  }, []);

  const refresh = useCallback(
    async (silent = true) => {
      await load(silent);
      await refreshListing();
    },
    [load, refreshListing]
  );

  const markNotificationRead = useCallback(async (id: string) => {
    try {
      await hotelApi.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((item) => (item._id === id ? { ...item, isRead: true } : item))
      );
    } catch (readError) {
      toast.error(apiErrorMessage(readError, "Could not mark the notification as read."));
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("userRole");
    localStorage.removeItem("tokenExpiresAt");
    localStorage.removeItem("hotelId");
    window.dispatchEvent(new Event("storageUpdate"));
    navigate("/sign-in", { replace: true });
  };

  const context = useMemo<HotelDashboardContextValue>(
    () => ({
      hotel,
      stats,
      rooms,
      listing,
      readiness,
      notifications,
      unreadCount: notifications.filter((item) => !item.isRead).length,
      loading,
      error,
      refresh,
      refreshListing,
      markNotificationRead,
    }),
    [
      hotel,
      stats,
      rooms,
      listing,
      readiness,
      notifications,
      loading,
      error,
      refresh,
      refreshListing,
      markNotificationRead,
    ]
  );

  const unread = notifications.filter((item) => !item.isRead).length;
  const crumb = CRUMB_LABELS[location.pathname];

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-700">
      {/* ------------------------------ top bar ------------------------------ */}
      <header className="z-30 flex h-16 shrink-0 items-center justify-between border-b border-teal-100 bg-white px-4 shadow-sm md:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 lg:hidden"
            aria-label="Toggle navigation"
          >
            {sidebarOpen ? <FiX size={20} /> : <FiMenu size={20} />}
          </button>

          <Link to="/hoteldashboard" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600 text-white">
              <FiHome size={18} />
            </span>
            <span className="hidden text-sm font-bold text-slate-900 sm:block">
              Hotel Dashboard
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          {hotel && (
            <span className="hidden items-center gap-2 md:flex">
              <StatusBadge status={hotel.listingStatus} />
              {stats?.hasUnpublishedChanges && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  Unpublished changes
                </span>
              )}
            </span>
          )}

          <button
            type="button"
            onClick={() => void load(true)}
            title="Refresh"
            aria-label="Refresh data"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-teal-600"
          >
            <FiRefreshCw size={18} />
          </button>

          {/* notifications */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setBellOpen((open) => !open)}
              aria-label="Notifications"
              className="relative rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-teal-600"
            >
              <FiBell size={18} />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>

            {bellOpen && (
              <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-card-lg">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">Notifications</p>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 && (
                    <p className="px-4 py-8 text-center text-sm text-slate-500">
                      Nothing yet. Approval updates will show up here.
                    </p>
                  )}
                  {notifications.map((item) => (
                    <button
                      key={item._id}
                      type="button"
                      onClick={() => {
                        if (!item.isRead) void markNotificationRead(item._id);
                        setBellOpen(false);
                      }}
                      className={`block w-full border-b border-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                        item.isRead ? "opacity-60" : ""
                      }`}
                    >
                      <p className="text-sm text-slate-800">{item.message}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* account menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setUserOpen((open) => !open)}
              className="flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-slate-100"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
                {(hotel?.hotelName || "H").charAt(0).toUpperCase()}
              </span>
              <span className="hidden text-sm font-medium text-slate-700 sm:block">
                {hotel?.hotelName || "Hotel"}
              </span>
              <FiChevronDown size={14} className="hidden text-slate-400 sm:block" />
            </button>

            {userOpen && (
              <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-slate-100 bg-white text-slate-700 shadow-card-lg">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {hotel?.hotelName || "Hotel"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {hotel?.hotelId} · {statusLabel(hotel?.listingStatus ?? "draft")}
                  </p>
                </div>
                <Link
                  to="/hoteldashboard/listing"
                  onClick={() => setUserOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-slate-50"
                >
                  <FiCheckCircle /> Listing status
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setUserOpen(false);
                    setShowLogout(true);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-rose-600 transition-colors hover:bg-rose-50"
                >
                  <FiLogOut /> Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* ------------------------------ sidebar ------------------------------ */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-teal-100 bg-teal-50 text-slate-700 transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <nav className="w-full flex-1 overflow-y-auto p-4">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title} className="mb-4 last:mb-0">
                <p className="mb-1.5 px-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {section.title}
                </p>
                <ul className="space-y-1">
                  {section.links.map(({ label, path, icon }) => (
                    <li key={path}>
                      <NavLink
                        to={path}
                        end={path === "/hoteldashboard"}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-3 rounded-lg border-l-4 px-4 py-2.5 text-sm font-medium transition-colors ${
                            isActive
                              ? "border-teal-600 bg-teal-600 font-semibold text-white"
                              : "border-transparent text-slate-600 hover:bg-teal-100/60 hover:text-teal-900"
                          }`
                        }
                      >
                        <span className="inline-flex">{icon}</span>
                        {label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {hotel && (
              <div className="mt-6 rounded-xl border border-teal-100 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Listing
                </p>
                <div className="mt-2">
                  <StatusBadge status={hotel.listingStatus} />
                </div>
                {stats?.publishedVersion ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Published v{stats.publishedVersion}
                    {stats.hasUnpublishedChanges ? " · draft has newer edits" : " · up to date"}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">Never published yet</p>
                )}
              </div>
            )}
          </nav>

          <div className="mt-auto w-full border-t border-teal-100 p-4">
            <button
              type="button"
              onClick={() => setShowLogout(true)}
              className="flex w-full items-center gap-3 rounded-lg border-l-4 border-transparent px-4 py-2.5 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-700"
            >
              <FiLogOut size={18} />
              Logout
            </button>
          </div>
        </aside>

        {/* ------------------------------ content ------------------------------ */}
        <main ref={mainRef} className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {loading && !hotel ? (
            <Spinner label="Loading your dashboard…" />
          ) : (
            <>
              {error && (
                <div className="mb-6">
                  <Alert tone="danger">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>{error}</span>
                      <Button variant="secondary" onClick={() => void load()}>
                        Retry
                      </Button>
                    </div>
                  </Alert>
                </div>
              )}

              {!hotel && !error && (
                <Alert tone="warning">
                  We could not find a hotel account for this login. Contact support if this
                  looks wrong.
                </Alert>
              )}

              {hotel && (
                <>
                  {crumb && crumb !== "Dashboard" && (
                    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500">
                      <Link to="/hoteldashboard" className="hover:text-teal-600">
                        Dashboard
                      </Link>
                      <span className="mx-2">/</span>
                      <span className="font-medium text-slate-700">{crumb}</span>
                    </nav>
                  )}

                  <Outlet context={context} />
                </>
              )}
            </>
          )}
        </main>
      </div>

      <ScrollToTopButton scrollTarget={mainRef} />
      <LogoutConfirmModal
        open={showLogout}
        onCancel={() => setShowLogout(false)}
        onConfirm={handleLogout}
      />
    </div>
  );
};

export default HotelDashboard;
