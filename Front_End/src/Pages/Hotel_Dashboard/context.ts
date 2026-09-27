/**
 * The data the hotel dashboard shell publishes to its screens.
 * ------------------------------------------------------------------
 * Lives in its own module (rather than beside the shell component) so
 * `HotelDashboard.tsx` exports only a component, and so screens can depend on
 * the shared shape without importing the whole shell.
 */
import { useOutletContext } from "react-router-dom";
import type {
  HotelAccount,
  HotelRoom,
  HotelStats,
  ListingStatusResponse,
  ReadinessReport,
  RoomNotification,
} from "../../api/hotel";

export interface HotelDashboardContextValue {
  hotel: HotelAccount | null;
  stats: HotelStats | null;
  rooms: HotelRoom[];
  listing: ListingStatusResponse | null;
  readiness: ReadinessReport | null;
  notifications: RoomNotification[];
  unreadCount: number;
  loading: boolean;
  error: string;
  /** Re-fetch the shared data. Pass `true` to keep the current page visible. */
  refresh: (silent?: boolean) => Promise<void>;
  /** Refresh only the listing lifecycle data. */
  refreshListing: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
}

/** Read the data the shell published through the router outlet. */
export const useHotelDashboard = (): HotelDashboardContextValue => {
  const context = useOutletContext<HotelDashboardContextValue | null>();
  if (!context) {
    throw new Error("useHotelDashboard must be used inside a <HotelDashboard /> route.");
  }
  return context;
};
