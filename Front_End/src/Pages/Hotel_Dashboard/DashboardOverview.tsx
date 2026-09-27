/**
 * Hotel dashboard — overview.
 * ------------------------------------------------------------------
 * Answers three questions on arrival: is my listing live, what is blocking
 * approval, and what should I fix next. Every number comes from the shared
 * shell context so this screen never fetches on its own.
 */
import { Link } from "react-router-dom";
import { FiAlertTriangle, FiArrowRight, FiCheckCircle, FiImage, FiPlusCircle } from "react-icons/fi";
import { imageSrc, type ReadinessIssue } from "../../api/hotel";
import { useHotelDashboard } from "./context";
import { money, statusLabel } from "./helpers";
import { Alert, Card, PageHeader, StatCard, StatusBadge } from "./ui";

/* ------------------------------------------------------------------ */
/* Readiness list                                                       */
/* ------------------------------------------------------------------ */

const IssueRow = ({ issue, tone }: { issue: ReadinessIssue; tone: "blocker" | "warning" }) => {
  const isBlocker = tone === "blocker";
  return (
    <li
      className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${
        isBlocker ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-amber-50 text-amber-800 ring-amber-200"
      }`}
    >
      <span className="mt-0.5 shrink-0">
        {isBlocker ? <FiAlertTriangle size={16} /> : <FiCheckCircle size={16} />}
      </span>
      <span className="flex-1">{issue.message}</span>
      <code className="shrink-0 rounded bg-white/60 px-1.5 py-0.5 text-[11px]">
        {issue.field}
      </code>
    </li>
  );
};

/** Where the user should go to resolve a given blocker field. */
const FIELD_ROUTES: Array<[string, string, string]> = [
  ["hotelName", "/hoteldashboard/profile", "Complete the hotel profile"],
  ["description", "/hoteldashboard/profile", "Write the hotel description"],
  ["address", "/hoteldashboard/profile", "Add the property address"],
  ["city", "/hoteldashboard/profile", "Add the city"],
  ["contact", "/hoteldashboard/profile", "Add a contact phone or email"],
  ["coverImage", "/hoteldashboard/profile", "Upload a cover image"],
  ["images", "/hoteldashboard/profile", "Add more photos"],
  ["amenities", "/hoteldashboard/profile", "Select amenities"],
  ["rooms", "/hoteldashboard/rooms", "Add a room type"],
  ["policies", "/hoteldashboard/policies", "Review your policies"],
];

const routeForIssue = (issue: ReadinessIssue) => {
  const entry = FIELD_ROUTES.find(([prefix]) => issue.field?.startsWith(prefix));
  return entry ? { to: entry[1], label: entry[2] } : null;
};

/** One link per screen that owns at least one blocker, in screen order. */
const QuickLinks = ({ blockers }: { blockers: ReadinessIssue[] }) => {
  const links = new Map<string, string>();
  for (const issue of blockers) {
    const route = routeForIssue(issue);
    if (route && !links.has(route.to)) links.set(route.to, route.label);
  }
  if (links.size === 0) return null;

  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {[...links].map(([to, label]) => (
        <Link
          key={to}
          to={to}
          className="inline-flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-700 transition-colors hover:bg-teal-100"
        >
          {label}
          <FiArrowRight size={13} />
        </Link>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */

const DashboardOverview = () => {
  const { hotel, stats, rooms, listing, readiness } = useHotelDashboard();

  if (!hotel) return null;

  const firstName = (hotel.hotelName || "your hotel").split(" ")[0];
  const blockers = readiness?.blockers ?? [];
  const warnings = readiness?.warnings ?? [];
  const activeRooms = rooms.filter((room) => !room.isArchived && room.isActive);
  const isLive = hotel.listingStatus === "published";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        subtitle={`Manage your listing, rooms and availability for ${hotel.hotelId}.`}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={hotel.listingStatus} />
            <Link
              to="/hoteldashboard/listing"
              className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
            >
              Manage listing <FiArrowRight size={16} />
            </Link>
          </div>
        }
      />

      {/* --------------------------- account gate --------------------------- */}
      {!stats?.isAccountActive && (
        <Alert tone="warning">
          <strong>Your account is awaiting admin activation.</strong> You can prepare everything
          here, but the dashboard API will reject writes until an admin activates your account.
        </Alert>
      )}

      {hotel.listingStatus === "rejected" && listing?.rejectionReason && (
        <Alert tone="danger">
          <strong>Your listing was rejected.</strong> {listing.rejectionReason}
        </Alert>
      )}

      {hotel.listingStatus === "suspended" && hotel.statusMeta?.suspendedReason && (
        <Alert tone="danger">
          <strong>Your listing is suspended.</strong> {hotel.statusMeta.suspendedReason}
        </Alert>
      )}

      {isLive && stats?.hasUnpublishedChanges && (
        <Alert tone="info">
          <strong>You have unpublished edits.</strong> Customers still see the last approved
          version. Submit again from{" "}
          <Link to="/hoteldashboard/listing" className="font-semibold underline">
            listing status
          </Link>{" "}
          to publish your changes.
        </Alert>
      )}

      {/* ------------------------------ stats ------------------------------ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Room types"
          value={stats?.roomCount ?? 0}
          hint={`${stats?.activeRooms ?? 0} active · ${stats?.archivedRooms ?? 0} archived`}
        />
        <StatCard
          label="Total inventory"
          value={stats?.totalInventory ?? 0}
          hint="Rooms sellable across all types"
          tone="slate"
        />
        <StatCard
          label="Free rooms tonight"
          value={stats?.availableNow ?? 0}
          hint={`${stats?.soldOutNights ?? 0} sold-out nights ahead`}
          tone="amber"
        />
        <StatCard
          label="Earnings"
          value={money(stats?.totalEarnings)}
          hint={`Commission ${money(stats?.totalCommission)}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* --------------------------- readiness --------------------------- */}
        <Card
          className="lg:col-span-2"
          title="Ready for review?"
          description="Everything below must be fixed before you can submit for approval."
          action={
            readiness && (
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  readiness.ready
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-rose-100 text-rose-800"
                }`}
              >
                {readiness.ready ? "Ready" : `${blockers.length} blocker(s)`}
              </span>
            )
          }
        >
          {blockers.length === 0 && warnings.length === 0 && (
            <Alert tone="success">
              Nothing outstanding. You can submit your listing for approval.
            </Alert>
          )}

          {blockers.length > 0 && (
            <ul className="space-y-2">
              {blockers.map((issue, index) => (
                <IssueRow key={`blocker-${index}`} issue={issue} tone="blocker" />
              ))}
            </ul>
          )}

          {warnings.length > 0 && (
            <ul className="mt-3 space-y-2">
              {warnings.map((issue, index) => (
                <IssueRow key={`warning-${index}`} issue={issue} tone="warning" />
              ))}
            </ul>
          )}

          {blockers.length > 0 && (
            <QuickLinks blockers={blockers} />
          )}
        </Card>

        {/* ---------------------------- summary ---------------------------- */}
        <div className="space-y-6">
          <Card title="Listing">
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Status</dt>
                <dd>
                  <StatusBadge status={hotel.listingStatus} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Published version</dt>
                <dd className="font-semibold text-slate-800">
                  {stats?.publishedVersion ? `v${stats.publishedVersion}` : "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Unpublished changes</dt>
                <dd className="font-semibold text-slate-800">
                  {stats?.hasUnpublishedChanges ? "Yes" : "No"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Type</dt>
                <dd className="font-semibold text-slate-800">{hotel.type}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Rating</dt>
                <dd className="font-semibold text-slate-800">
                  {hotel.starRating} star{hotel.starRating === 1 ? "" : "s"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Photos</dt>
                <dd className="font-semibold text-slate-800">{hotel.images?.length ?? 0}/12</dd>
              </div>
            </dl>
          </Card>

          {hotel.coverImage && (
            <Card title="Cover image">
              <img
                src={imageSrc(hotel.coverImage)}
                alt="Hotel cover"
                className="h-40 w-full rounded-xl object-cover"
              />
              <Link
                to="/hoteldashboard/profile"
                className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-teal-600 hover:text-teal-700"
              >
                <FiImage size={15} /> Change photos
              </Link>
            </Card>
          )}
        </div>
      </div>

      {/* ------------------------------ rooms ------------------------------ */}
      <Card
        title="Room types"
        description={`${activeRooms.length} active room type(s) in this listing.`}
        action={
          <Link
            to="/hoteldashboard/rooms"
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
          >
            <FiPlusCircle size={16} /> Add room
          </Link>
        }
      >
        {activeRooms.length === 0 ? (
          <Alert tone="warning">
            You have no active room types. Add at least one room with a description, price and
            inventory before submitting.
          </Alert>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2.5 pr-4 font-semibold">Room</th>
                  <th className="py-2.5 pr-4 font-semibold">Category</th>
                  <th className="py-2.5 pr-4 font-semibold">Sleeps</th>
                  <th className="py-2.5 pr-4 font-semibold">Inventory</th>
                  <th className="py-2.5 font-semibold">From / night</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {activeRooms.map((room) => (
                  <tr key={room._id}>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        {room.coverImage ? (
                          <img
                            src={imageSrc(room.coverImage)}
                            alt={room.name}
                            className="h-10 w-14 rounded-lg object-cover"
                          />
                        ) : (
                          <span className="flex h-10 w-14 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-semibold text-slate-400">
                            No photo
                          </span>
                        )}
                        <span className="font-semibold text-slate-800">{room.name}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{room.type}</td>
                    <td className="py-3 pr-4 text-slate-600">{room.maxGuests} guests</td>
                    <td className="py-3 pr-4 text-slate-600">{room.totalRooms} rooms</td>
                    <td className="py-3 font-semibold text-slate-800">
                      {money(room.pricing?.basePrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-center text-xs text-slate-400">
        Listing status: {statusLabel(hotel.listingStatus)} · You keep editing your draft even
        while a submission is under review.
      </p>
    </div>
  );
};

export default DashboardOverview;
