import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaArrowLeft,
  FaBus,
  FaCar,
  FaArrowRight,
  FaCalendarAlt,
  FaMapMarkerAlt,
  FaCreditCard,
  FaMoneyBillWave,
  FaCheckCircle,
  FaUser,
  FaUsers,
  FaMinus,
  FaPlus,
  FaBolt,
} from "react-icons/fa";
import { bookingsApi, homeApi, API_BASE_URL, type Booking, type Bus, type Vehicle } from "../../api";
import { formatMoney } from "../../utils/format";
import { bookingNumberOf, formatSeatLabel } from "../../utils/ticket";
import { dateKey, formatTakeoffDate, formatTakeoffTime } from "../../utils/datetime";
import AdminPageHeader from "../../Component/Admin Component/AdminPageHeader";
import BusSeatGrid from "../../Component/BusSeatGrid";
import BookingTicket from "../../Component/BookingTicket";
import EmailStatusBadge from "../../Component/EmailStatusBadge";

interface OutletContext {
  vehicles: Vehicle[];
  buses: Bus[];
  bookings: Booking[];
  loading: boolean;
  error: string;
  fetchData: () => void;
}

interface SearchForm {
  pickup: string;
  drop: string;
  date: string;
}

interface Customer {
  name: string;
  phone: string;
  email: string;
}

interface PassengerRow {
  name: string;
  phone: string;
}

const toLocalDateKey = (date: string | Date): string => {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const imageUrlFor = (image?: string, fallback = "/default-bus-image.jpg") =>
  image
    ? image.startsWith("http")
      ? image
      : `${API_BASE_URL}${image}`
    : fallback;

const departureLabel = (d?: string | Date): string =>
  d ? `${formatTakeoffDate(d, { withWeekday: true })}, ${formatTakeoffTime(d)}` : "Date TBD";

const busFreeSeats = (bus: Bus): number => bus.totalSeats - (bus.bookedSeats || []).length;

const BookTicket = () => {
  const { buses, vehicles, bookings, fetchData } = useOutletContext<OutletContext>();
  const location = useLocation();
  const navigate = useNavigate();

  const bookingsPath = location.pathname.startsWith("/Admin_Dashboard")
    ? "/Admin_Dashboard/bookings"
    : "/VendorDashboard/bookings";

  const queryParams = new URLSearchParams(location.search);
  const paidParam = queryParams.get("paid") === "1";
  const bookingParam = queryParams.get("booking");

  /* Two-stage flow: "select" shows the fleet, "book" runs the existing booking
     page. Landing on a payment callback must go straight to the ticket. */
  const [stage, setStage] = useState<"select" | "book">(bookingParam ? "book" : "select");

  const [form, setForm] = useState<SearchForm>({ pickup: "", drop: "", date: "" });
  const [passengerCount, setPassengerCount] = useState(1);

  const [selectedBus, setSelectedBus] = useState<Bus | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [covSeats, setCovSeats] = useState<number[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const [reservationDate, setReservationDate] = useState("");
  const [pickupPoint, setPickupPoint] = useState("");
  const [dropPoint, setDropPoint] = useState("");

  const [customer, setCustomer] = useState<Customer>({ name: "", phone: "", email: "" });
  const [passengerRows, setPassengerRows] = useState<PassengerRow[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"Online" | "CashOnVisit">("CashOnVisit");
  const [processing, setProcessing] = useState(false);

  const [lastBookingId, setLastBookingId] = useState<string | null>(bookingParam || null);
  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);

  /* number of passengers to carry into the details step */
  const seatCount = selectedBus ? selectedSeats.length : passengerCount;

  /* date-aware availability: a vehicle is only blocked when a reservation
     actually overlaps the searched date (or, without a search date, when there
     is still an unexpired reservation). The legacy `isAvailable` flag is only a
     fallback for vehicles that have no dated reservation history. */
  const vehicleBlocked = (vehicle: Vehicle): boolean => {
    const reservations = vehicle.reservations || [];
    if (form.date) {
      if (reservations.length === 0) return false;
      return reservations.some(
        (r) =>
          r.reservedFrom &&
          r.reservedUntil &&
          form.date >= toLocalDateKey(r.reservedFrom) &&
          form.date <= toLocalDateKey(r.reservedUntil)
      );
    }
    if (reservations.length === 0) return vehicle.isAvailable === false;
    return reservations.some((r) => r.reservedUntil && new Date(r.reservedUntil) >= new Date());
  };

  /* ---- fleet for the selection screen (no filters) ---- */
  const availableBuses = useMemo(() => {
    const now = Date.now();
    return buses
      .filter((bus) => !bus.takeOffDate || new Date(bus.takeOffDate).getTime() >= now)
      .sort(
        (a, b) =>
          (a.takeOffDate ? new Date(a.takeOffDate).getTime() : 0) -
          (b.takeOffDate ? new Date(b.takeOffDate).getTime() : 0)
      )
      .map((bus) => {
        const booked = (bus.bookedSeats || []).length;
        return { ...bus, available: bus.totalSeats - booked, bookedSeatCount: booked };
      });
  }, [buses]);

  const fleetEmpty = availableBuses.length === 0 && vehicles.length === 0;

  /* ---- resolve the booking to display after payment / cash booking ---- */
  useEffect(() => {
    if (!lastBookingId) return;
    const found = bookings.find((b) => b._id === lastBookingId);
    if (found) {
      setCreatedBooking(found);
      setLastBookingId(null);
    }
  }, [bookings, lastBookingId]);

  /* keep the passenger forms sized to the booking */
  useEffect(() => {
    setPassengerRows((prev) => {
      const next = Array.from(
        { length: seatCount },
        (_, i) =>
          prev[i] || { name: customer.name || "", phone: customer.phone || "" }
      );
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatCount]);

  /* ---- select a trip ---- */
  const selectBus = async (bus: Bus) => {
    setLoadingDetails(true);
    try {
      const [detail, cov] = await Promise.all([
        homeApi.getBusById(bus._id),
        bookingsApi.getCovSeats(bus._id),
      ]);
      setSelectedBus(detail.bus || bus);
      setSelectedVehicle(null);
      setSelectedSeats([]);
      setCovSeats((cov.covSeats || []).map(Number));
      if (detail.bus?.takeOffDate && detail.bus?.pickupPoint && detail.bus?.dropPoint) {
        setForm((prev) => ({
          pickup: prev.pickup,
          drop: prev.drop,
          date: toLocalDateKey(detail.bus.takeOffDate!),
        }));
      }
      setStage("book");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      console.error("Select bus error:", err);
      toast.error("Failed to load bus details.");
    } finally {
      setLoadingDetails(false);
    }
  };

  const selectVehicle = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    setSelectedBus(null);
    setSelectedSeats([]);
    setPickupPoint(vehicle.pickupPoint || "");
    setDropPoint(vehicle.dropPoint || "");
    setReservationDate(form.date || "");
    setStage("book");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* back to the fleet grid (drop the bus-specific search date so vehicle
     availability falls back to unexpired reservations again) */
  const goToFleet = () => {
    setStage("select");
    setForm((prev) => ({ ...prev, date: "" }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const clearSelection = () => {
    setSelectedBus(null);
    setSelectedVehicle(null);
    setSelectedSeats([]);
    setCovSeats([]);
    setReservationDate("");
    setPickupPoint("");
    setDropPoint("");
  };

  const toggleSeat = (seatNumber: number) => {
    setSelectedSeats((prev) =>
      prev.includes(seatNumber)
        ? prev.filter((num) => num !== seatNumber)
        : [...prev, seatNumber]
    );
  };

  const autoPickSeats = () => {
    if (!selectedBus) return;
    const taken = new Set([...(selectedBus.bookedSeats || []).map(Number), ...covSeats]);
    const total = selectedBus.totalSeats || 0;
    const want = Math.min(passengerCount, total);
    const picks: number[] = [];
    for (let s = 1; s <= total && picks.length < want; s++) {
      if (!taken.has(s)) picks.push(s);
    }
    setSelectedSeats(picks);
  };

  /* ---- pricing -- */
  const totalPrice = useMemo(() => {
    if (selectedBus) return selectedBus.pricePerSeat * selectedSeats.length;
    if (selectedVehicle) return selectedVehicle.price || 0;
    return 0;
  }, [selectedBus, selectedVehicle, selectedSeats]);

  const commissionRate = 10;
  const commissionAmount = Math.round(totalPrice * (commissionRate / 100) * 100) / 100;
  const vendorEarnings = Math.round((totalPrice - commissionAmount) * 100) / 100;

  const resetAll = () => {
    clearSelection();
    setForm({ pickup: "", drop: "", date: "" });
    setPassengerCount(1);
    setCustomer({ name: "", phone: "", email: "" });
    setPassengerRows([]);
    setCreatedBooking(null);
    setLastBookingId(null);
    setStage("select");
    navigate(location.pathname, { replace: true });
    window.scrollTo(0, 0);
  };

  /* ---- section gating (single page, unlocks downward) ---- */
  const tripReady = selectedBus
    ? selectedSeats.length > 0
    : selectedVehicle
    ? Boolean(reservationDate.trim() && pickupPoint.trim() && dropPoint.trim())
    : false;

  const customerReady =
    Boolean(customer.name.trim()) &&
    Boolean(customer.email.trim()) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim());

  const canConfirm = tripReady && customerReady;

  const validateTripStep = () => {
    if (selectedBus && selectedSeats.length === 0) {
      return "Please select at least one seat before continuing.";
    }
    if (selectedVehicle && (!reservationDate.trim() || !pickupPoint.trim() || !dropPoint.trim())) {
      return "Please fill the reservation date, pickup and drop locations.";
    }
    return null;
  };

  /* ---- submit ---- */
  const buildPayload = () => ({
    type: selectedBus ? ("bus" as const) : ("vehicle" as const),
    itemId: selectedBus?._id || selectedVehicle?._id || "",
    seats: selectedBus ? selectedSeats : undefined,
    takeOffDate: selectedBus ? selectedBus.takeOffDate : reservationDate,
    pickupPoint: selectedVehicle ? pickupPoint : undefined,
    dropPoint: selectedVehicle ? dropPoint : undefined,
    customerName: customer.name.trim(),
    customerPhone: customer.phone.trim(),
    customerEmail: customer.email.trim(),
    passengers: passengerRows.map((p) => ({ name: p.name.trim(), phone: p.phone.trim() })),
  });

  const handleConfirm = async () => {
    if (!customer.name.trim()) {
      toast.error("Customer name is required.");
      return;
    }
    if (!customer.email.trim()) {
      toast.error("Customer email is required so the ticket can be emailed.");
      return;
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim()) === false) {
      toast.error("Please enter a valid customer email so the ticket can be emailed.");
      return;
    }
    const invalidTrip = validateTripStep();
    if (invalidTrip) {
      toast.error(invalidTrip);
      return;
    }

    setProcessing(true);
    try {
      const payload = buildPayload();

      if (paymentMethod === "CashOnVisit") {
        const res = (await bookingsApi.cashOnVisit(payload)) as { bookingId?: string };
        toast.success("Booking placed. Cash on Visit is pending confirmation.");
        if (res.bookingId) setLastBookingId(res.bookingId);
        clearSelection();
        setCustomer({ name: "", phone: "", email: "" });
        setPassengerRows([]);
        window.scrollTo(0, 0);
        await fetchData();
      } else {
        const res = (await bookingsApi.initiatePayment(payload)) as { payment_url?: string };
        if (res.payment_url) {
          window.open(res.payment_url, "_blank", "noopener,noreferrer");
          toast.info("Complete payment in the new tab. Your ticket will appear here after payment.");
        } else {
          toast.error("Payment initiation failed. Please try again.");
        }
      }
    } catch (err) {
      const axiosErr = err as {
        response?: { status?: number; data?: { message?: string; code?: string; conflictSeats?: number[] } };
        message?: string;
      };
      console.error("Booking error:", axiosErr);

      const respData = axiosErr.response?.data || {};
      const status = axiosErr.response?.status;
      const isConflict = status === 409 || respData.code === "SEAT_CONFLICT" || respData.code === "VEHICLE_CONFLICT";

      if (isConflict) {
        const conflictSeats = respData.conflictSeats || [];
        toast.error(respData.message || "Selection just became unavailable. Please re-check and try again.");

        // Auto-recover: re-fetch availability, drop the conflicted seats (or the
        // vehicle) so the vendor can re-pick on the same page and resubmit.
        if (respData.code === "SEAT_CONFLICT" && selectedBus) {
          try {
            const [detail, cov] = await Promise.all([
              homeApi.getBusById(selectedBus._id),
              bookingsApi.getCovSeats(selectedBus._id),
            ]);
            if (detail.bus) setSelectedBus(detail.bus);
            setCovSeats((cov.covSeats || []).map(Number));
            setSelectedSeats((prev) => prev.filter((seat) => !conflictSeats.includes(seat)));
          } catch {
            // Fresh state failed to load; leave the current bus details intact.
          }
        } else if (respData.code === "VEHICLE_CONFLICT") {
          setSelectedVehicle(null);
          setSelectedSeats([]);
        }
      } else {
        toast.error(axiosErr.response?.data?.message || axiosErr.message || "Failed to create booking.");
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleEmailTicket = async (id: string) => {
    try {
      const res = (await bookingsApi.sendTicket(id)) as { emailStatus?: string };
      setCreatedBooking((prev) =>
        prev && prev._id === id
          ? { ...prev, emailStatus: res.emailStatus || "Sent", emailSentAt: new Date().toISOString(), emailError: undefined }
          : prev
      );
      toast.success("Ticket emailed to the customer.");
    } catch (err) {
      const axiosErr = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(axiosErr.response?.data?.message || axiosErr.message || "Failed to email the ticket.");
    }
  };

  /* ======================= RENDER ======================= */
  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <AdminPageHeader
        title="Book Bus / Vehicle Ticket"
        subtitle="Choose an available bus or vehicle from your fleet, then complete the booking."
      >
        <span className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-indigo-700 shadow">
          {buses.length} buses · {vehicles.length} vehicles
        </span>
        <Link
          to={bookingsPath}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50"
        >
          View Bookings
        </Link>
      </AdminPageHeader>

      {paidParam && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-800">
          <FaCheckCircle className="mt-0.5 shrink-0 text-emerald-600" />
          <div>
            <p className="font-semibold">Payment successful</p>
            <p className="text-sm">
              The online payment was recorded. Your ticket is below — you can email or download it, or book another trip.
            </p>
          </div>
        </div>
      )}

      {createdBooking ? (
        /* ------------------------------------------------ */
        /*  Confirmation & ticket (same page)               */
        /* ------------------------------------------------ */
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              {createdBooking.bookingNumber && (
                <p className="rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-bold text-indigo-700">
                  {createdBooking.bookingNumber}
                </p>
              )}
              <EmailStatusBadge status={createdBooking.emailStatus} error={createdBooking.emailError} />
            </div>
            <h2 className="mt-2 text-lg font-bold text-slate-900">Ticket Issued</h2>
            <p className="text-sm text-slate-500">
              Booking No {bookingNumberOf(createdBooking)} is visible in the Bookings section
              under Payment Management for confirmation and settlement. The PDF ticket was emailed to the customer automatically.
            </p>
          </div>
          <BookingTicket booking={createdBooking} onEmail={handleEmailTicket} />
          <div className="flex flex-wrap gap-3">
            <button
              onClick={resetAll}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              Book another
            </button>
            <Link
              to={bookingsPath}
              className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Go to Bookings
            </Link>
          </div>
        </div>
      ) : stage === "select" ? (
        /* ------------------------------------------------ */
        /*  Step 1 — Available Buses & Vehicles (pure grid) */
        /* ------------------------------------------------ */
        <section className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">Available Buses & Vehicles</h2>
          <p className="mt-1 text-sm text-slate-500">
            Select the transport you want to book — the seats and passenger form open next.
          </p>

          {availableBuses.length > 0 && (
            <>
              <h3 className="mb-3 mt-6 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <FaBus className="text-indigo-600" /> Buses
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {availableBuses.map((bus) => (
                  <div
                    key={bus._id}
                    className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-card"
                  >
                    <div className="flex items-start gap-3">
                      <img
                        src={imageUrlFor(bus.image)}
                        alt={bus.name}
                        className="h-16 w-16 shrink-0 rounded-xl object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = "/default-bus-image.jpg";
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="flex items-center gap-2 truncate font-bold text-slate-900">
                          <FaBus className="shrink-0 text-indigo-600" />
                          {bus.name || bus.busName || "Bus"}
                        </h3>
                        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                          <FaMapMarkerAlt className="text-teal-600" />
                          {bus.pickupPoint} <FaArrowRight className="text-slate-400" /> {bus.dropPoint}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                          <FaCalendarAlt className="text-indigo-500" />
                          Departure: {departureLabel(bus.takeOffDate)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
                      <div>
                        <p className="text-xs text-slate-500">Total Seats</p>
                        <p className="mt-0.5 text-base font-bold text-slate-800">{bus.totalSeats}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Available</p>
                        <p className="mt-0.5 text-base font-bold text-emerald-700">{bus.available}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Booked</p>
                        <p className="mt-0.5 text-base font-bold text-rose-600">{bus.bookedSeatCount}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                      <div>
                        <p className="text-xs text-slate-500">Fare</p>
                        <p className="text-sm font-bold text-slate-900">{formatMoney(bus.pricePerSeat)} / seat</p>
                      </div>
                      <button
                        onClick={() => selectBus(bus)}
                        disabled={loadingDetails}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {loadingDetails ? "Loading…" : "Select Bus"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {vehicles.length > 0 && (
            <>
              <h3 className="mb-3 mt-8 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <FaCar className="text-indigo-600" /> Vehicles
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {vehicles.map((vehicle) => {
                  const unavailable = vehicleBlocked(vehicle);
                  return (
                    <div
                      key={vehicle._id}
                      className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-card"
                    >
                      <div className="flex items-start gap-3">
                        <img
                          src={imageUrlFor(vehicle.image, "/default-vehicle.jpg")}
                          alt={vehicle.name}
                          className="h-16 w-16 shrink-0 rounded-xl object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = "/default-vehicle.jpg";
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <h3 className="flex items-center gap-2 truncate font-bold text-slate-900">
                            <FaCar className="shrink-0 text-indigo-600" />
                            {vehicle.name}
                          </h3>
                          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                            <FaMapMarkerAlt className="text-teal-600" />
                            {vehicle.pickupPoint || "N/A"} <FaArrowRight className="text-slate-400" />{" "}
                            {vehicle.dropPoint || "N/A"}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {vehicle.totalSeats || vehicle.capacity || "—"} seats · whole-vehicle rental
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-center">
                        <div>
                          <p className="text-xs text-slate-500">Capacity</p>
                          <p className="mt-0.5 text-base font-bold text-slate-800">
                            {vehicle.totalSeats || vehicle.capacity || "—"} seats
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Status</p>
                          <p
                            className={`mt-0.5 text-base font-bold ${
                              unavailable ? "text-rose-600" : "text-emerald-700"
                            }`}
                          >
                            {unavailable ? "Booked" : "Available"}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                        <div>
                          <p className="text-xs text-slate-500">Rental price</p>
                          <p className="text-sm font-bold text-slate-900">{formatMoney(vehicle.price)}</p>
                        </div>
                        <button
                          onClick={() => selectVehicle(vehicle)}
                          disabled={unavailable}
                          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Select
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {fleetEmpty && (
            <div className="mt-6 rounded-xl border-2 border-dashed border-slate-200 p-10 text-center">
              <FaBus className="mx-auto text-2xl text-slate-300" />
              <h3 className="mt-3 text-lg font-semibold text-slate-900">No available transport</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                Add a bus or a vehicle from your inventory management before you can book tickets.
              </p>
            </div>
          )}
        </section>
      ) : (
        /* ------------------------------------------------ */
        /*  Step 2 — booking page (left details + sticky)   */
        /* ------------------------------------------------ */
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* ================= LEFT ================= */}
          <div className="space-y-6 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                onClick={goToFleet}
                className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-700"
              >
                <FaArrowLeft /> Back to available trips
              </button>
              <button
                onClick={goToFleet}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                Change transport
              </button>
            </div>

            {/* Selected transport information */}
            {selectedBus && (
              <section className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <img
                      src={imageUrlFor(selectedBus.image)}
                      alt={selectedBus.name}
                      className="h-14 w-14 shrink-0 rounded-xl object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/default-bus-image.jpg";
                      }}
                    />
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-2 truncate font-bold text-slate-900">
                        <FaBus className="shrink-0 text-indigo-600" /> {selectedBus.name || "Bus"}
                      </h3>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        <FaMapMarkerAlt className="text-teal-600" />
                        {selectedBus.pickupPoint} <FaArrowRight className="text-slate-400" />{" "}
                        {selectedBus.dropPoint}
                        <span className="inline-flex items-center gap-1 text-indigo-600">
                          <FaCalendarAlt /> {departureLabel(selectedBus.takeOffDate)}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                      {busFreeSeats(selectedBus)} of {selectedBus.totalSeats} seats free
                    </span>
                    <span className="text-sm font-bold text-slate-900">
                      {formatMoney(selectedBus.pricePerSeat)} / seat
                    </span>
                  </div>
                </div>
              </section>
            )}

            {selectedVehicle && (
              <section className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <img
                      src={imageUrlFor(selectedVehicle.image, "/default-vehicle.jpg")}
                      alt={selectedVehicle.name}
                      className="h-14 w-14 shrink-0 rounded-xl object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/default-vehicle.jpg";
                      }}
                    />
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-2 truncate font-bold text-slate-900">
                        <FaCar className="shrink-0 text-indigo-600" /> {selectedVehicle.name}
                      </h3>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        <FaMapMarkerAlt className="text-teal-600" />
                        {selectedVehicle.pickupPoint || "N/A"} <FaArrowRight className="text-slate-400" />{" "}
                        {selectedVehicle.dropPoint || "N/A"}
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            vehicleBlocked(selectedVehicle)
                              ? "bg-rose-100 text-rose-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {vehicleBlocked(selectedVehicle) ? "Booked" : "Available"}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-sm font-bold text-slate-900">{formatMoney(selectedVehicle.price)}</span>
                    <span className="text-xs text-slate-500">
                      {selectedVehicle.totalSeats || selectedVehicle.capacity || "—"} seats
                    </span>
                  </div>
                </div>
              </section>
            )}

            {/* 3 — Seats / Reservation */}
            <section className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
              <h2 className="mb-4 text-lg font-bold text-slate-900">
                {selectedBus ? "Select Seats" : selectedVehicle ? "Reservation Details" : "Select Seats / Reservation"}
              </h2>

              {selectedBus ? (
                <div className="space-y-4">
                  {loadingDetails && (
                    <p className="text-sm font-medium text-amber-600">Refreshing seat availability…</p>
                  )}

                  <BusSeatGrid
                    bus={selectedBus}
                    selectedSeats={selectedSeats}
                    covSeats={covSeats}
                    onToggle={toggleSeat}
                  />

                  <div className="rounded-xl bg-teal-50/60 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-slate-800">Selected Seats</h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <Stepper
                          label="Seats to pick"
                          value={passengerCount}
                          min={1}
                          max={selectedBus.totalSeats || 30}
                          onChange={setPassengerCount}
                        />
                        <button
                          onClick={autoPickSeats}
                          className="inline-flex items-center gap-2 rounded-lg border border-teal-600 px-3 py-1.5 text-xs font-semibold text-teal-700 transition-colors hover:bg-teal-50"
                        >
                          <FaBolt /> Quick-pick {passengerCount} seat{passengerCount > 1 ? "s" : ""}
                        </button>
                      </div>
                    </div>
                    {selectedSeats.length === 0 ? (
                      <p className="rounded-xl border-2 border-dashed border-slate-200 p-4 text-center text-sm text-slate-400">
                        No seats selected yet — tap seats on the bus map to choose.
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {selectedSeats.map((seat) => (
                            <button
                              key={seat}
                              onClick={() => toggleSeat(seat)}
                              title="Deselect seat"
                              className="group flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition hover:bg-rose-500"
                            >
                              {formatSeatLabel(seat)}
                              <span className="hidden text-xs text-teal-100 group-hover:block">×</span>
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 flex items-center justify-between border-t border-teal-200 pt-3">
                          <p className="text-sm text-slate-600">
                            {selectedSeats.length} seat{selectedSeats.length > 1 ? "s" : ""} × {formatMoney(selectedBus.pricePerSeat)}
                          </p>
                          <p className="text-xl font-bold text-slate-900">{formatMoney(totalPrice)}</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : selectedVehicle ? (
                <div className="space-y-4">
                  <img
                    src={imageUrlFor(selectedVehicle.image, "/default-vehicle.jpg")}
                    alt={selectedVehicle.name}
                    className="aspect-video w-full rounded-xl object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "/default-vehicle.jpg";
                    }}
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
                    <Stepper
                      label="Passengers"
                      value={passengerCount}
                      onChange={setPassengerCount}
                    />
                    <span className="text-xs text-slate-500">
                      Whole vehicle · {selectedVehicle.totalSeats || selectedVehicle.capacity || "—"} seats
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label htmlFor="resDate" className="mb-1.5 block text-sm font-medium text-slate-700">
                        Reservation Date *
                      </label>
                      <input
                        id="resDate"
                        type="date"
                        className={inputCls}
                        value={reservationDate}
                        min={dateKey(new Date())}
                        onChange={(e) => setReservationDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="vehPickup" className="mb-1.5 block text-sm font-medium text-slate-700">
                        Pickup Location *
                      </label>
                      <input
                        id="vehPickup"
                        type="text"
                        className={inputCls}
                        placeholder="Pickup location"
                        value={pickupPoint}
                        onChange={(e) => setPickupPoint(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="vehDrop" className="mb-1.5 block text-sm font-medium text-slate-700">
                        Drop-off Location *
                      </label>
                      <input
                        id="vehDrop"
                        type="text"
                        className={inputCls}
                        placeholder="Drop-off location"
                        value={dropPoint}
                        onChange={(e) => setDropPoint(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center">
                  <FaUsers className="mx-auto text-2xl text-slate-300" />
                  <p className="mt-3 text-sm font-medium text-slate-500">
                    The selected transport became unavailable. Pick another one from your fleet.
                  </p>
                  <button
                    onClick={goToFleet}
                    className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                  >
                    Back to available trips
                  </button>
                </div>
              )}
            </section>

            {/* 4 — Passenger Details */}
            <section className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900">Passenger Details</h2>
              {!tripReady && (
                <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
                  Finish the trip selection above to unlock passenger details.
                </p>
              )}
              <div className={`space-y-4 ${tripReady ? "" : "pointer-events-none opacity-60"}`}>
                <ContactPanel customer={customer} setCustomer={setCustomer} />
                <PassengerPanel
                  rows={passengerRows}
                  onChange={setPassengerRows}
                  bus={selectedBus}
                  selectedSeats={selectedSeats}
                  onFillFromContact={() =>
                    setPassengerRows((prev) =>
                      prev.map((p) => ({
                        name: customer.name.trim() || p.name,
                        phone: customer.phone.trim() || p.phone,
                      }))
                    )
                  }
                />
              </div>
            </section>
          </div>

          {/* ================= RIGHT (sticky summary) ================= */}
          <aside className="space-y-6 self-start lg:sticky lg:top-6">
            <ReviewSummary
              bus={selectedBus}
              vehicle={selectedVehicle}
              selectedSeats={selectedSeats}
              reservationDate={reservationDate}
              pickupPoint={pickupPoint}
              dropPoint={dropPoint}
              passengerRows={passengerRows}
            />

            <PaymentPanel
              paymentMethod={paymentMethod}
              setPaymentMethod={setPaymentMethod}
              totalPrice={totalPrice}
              commissionAmount={commissionAmount}
              vendorEarnings={vendorEarnings}
              processing={processing}
              canConfirm={canConfirm}
              onConfirm={handleConfirm}
              bus={selectedBus}
              vehicle={selectedVehicle}
              selectedSeats={selectedSeats}
            />
          </aside>
        </div>
      )}

      {/* Sticky mobile checkout bar (booking step only) */}
      {!createdBooking && stage === "book" && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-slate-500">
                {selectedBus && selectedSeats.length > 0
                  ? `${selectedSeats.length} seat${selectedSeats.length > 1 ? "s" : ""} selected`
                  : selectedVehicle
                  ? "Whole vehicle"
                  : "Nothing selected"}
              </p>
              <p className="text-lg font-bold text-slate-900">{formatMoney(totalPrice)}</p>
            </div>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm || processing}
              className="rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-md transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {processing
                ? "Processing…"
                : paymentMethod === "Online"
                ? "Proceed to Payment"
                : "Confirm Booking"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ======================= Sub components ======================= */

const TripSummaryCard = ({ title, lines }: { title: string; lines: { label: string; value: string; bold?: boolean }[] }) => (
  <section className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
    <h2 className="mb-3 text-lg font-bold text-slate-900">{title}</h2>
    <div className="space-y-1.5 text-sm text-slate-600">
      {lines.map((line) => (
        <div key={line.label} className="flex justify-between gap-3">
          <span>{line.label}</span>
          <span className={`text-right ${line.bold ? "text-xl font-bold text-slate-900" : "font-semibold text-slate-800"}`}>
            {line.value}
          </span>
        </div>
      ))}
    </div>
  </section>
);

const inputCls =
  "w-full rounded-xl border border-gray-300 p-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30";

interface StepperProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

const Stepper = ({ label, value, onChange, min = 1, max = 30 }: StepperProps) => (
  <div className="flex items-center gap-2">
    <span className="text-xs font-medium text-slate-500">{label}</span>
    <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white p-0.5">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100"
      >
        <FaMinus />
      </button>
      <span className="flex w-8 items-center justify-center text-sm font-bold text-slate-800">{value}</span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100"
      >
        <FaPlus />
      </button>
    </div>
  </div>
);

interface ContactPanelProps {
  customer: Customer;
  setCustomer: (c: Customer) => void;
}

const ContactPanel = ({ customer, setCustomer }: ContactPanelProps) => (
  <section className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
    <h2 className="mb-4 text-lg font-bold text-slate-900">Booking Contact</h2>
    <p className="mb-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
      Walk-in customers don&apos;t need an account. These details are used for the ticket, receipts and payment.
    </p>
    <div className="space-y-4">
      <div>
        <label htmlFor="custName" className="mb-1.5 block text-sm font-medium text-slate-700">
          Name *
        </label>
        <input
          id="custName"
          type="text"
          className={inputCls}
          placeholder="Customer name"
          value={customer.name}
          onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="custPhone" className="mb-1.5 block text-sm font-medium text-slate-700">
          Phone
        </label>
        <input
          id="custPhone"
          type="tel"
          className={inputCls}
          placeholder="Phone number"
          value={customer.phone}
          onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="custEmail" className="mb-1.5 block text-sm font-medium text-slate-700">
          Email *
        </label>
        <input
          id="custEmail"
          type="email"
          className={inputCls}
          placeholder="Customer email"
          value={customer.email}
          onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
        />
        <p className="mt-1 text-xs text-slate-400">
          The ticket PDF is emailed to this address after the booking is created.
        </p>
      </div>
    </div>
  </section>
);

interface PassengerPanelProps {
  rows: PassengerRow[];
  onChange: (rows: PassengerRow[]) => void;
  bus: Bus | null;
  selectedSeats: number[];
  onFillFromContact: () => void;
}

const PassengerPanel = ({
  rows,
  onChange,
  bus,
  selectedSeats,
  onFillFromContact,
}: PassengerPanelProps) => (
  <section className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-bold text-slate-900">Passenger Details</h2>
      <button
        onClick={onFillFromContact}
        className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-50"
      >
        <FaUser /> Use contact name
      </button>
    </div>
    <p className="mb-3 text-sm text-slate-500">
      {rows.length} passenger{rows.length > 1 ? "s" : ""} — enter a name and phone for each seat.
    </p>
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-1 items-center gap-3 rounded-xl border border-slate-100 p-3 sm:grid-cols-12">
          <span className="flex items-center gap-2 text-sm font-bold text-slate-700 sm:col-span-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
              {i + 1}
            </span>
            {bus && selectedSeats[i] !== undefined ? (
              <span className="rounded bg-teal-100 px-2 py-0.5 text-xs font-bold text-teal-700">
                {formatSeatLabel(selectedSeats[i])}
              </span>
            ) : null}
          </span>
          <input
            type="text"
            className={`${inputCls} sm:col-span-5`}
            placeholder={`Passenger ${i + 1} name *`}
            value={row.name}
            onChange={(e) =>
              onChange(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
            }
          />
          <input
            type="tel"
            className={`${inputCls} sm:col-span-5`}
            placeholder="Passenger phone"
            value={row.phone}
            onChange={(e) =>
              onChange(rows.map((r, j) => (j === i ? { ...r, phone: e.target.value } : r)))
            }
          />
        </div>
      ))}
    </div>
  </section>
);

interface ReviewSummaryProps {
  bus: Bus | null;
  vehicle: Vehicle | null;
  selectedSeats: number[];
  reservationDate: string;
  pickupPoint: string;
  dropPoint: string;
  passengerRows: PassengerRow[];
}

const ReviewSummary = ({
  bus,
  vehicle,
  selectedSeats,
  reservationDate,
  pickupPoint,
  dropPoint,
  passengerRows,
}: ReviewSummaryProps) => {
  const lines: { label: string; value: string }[] = [];

  if (bus) {
    lines.push(
      { label: "Transport", value: bus.name || "Bus" },
      { label: "Route", value: `${bus.pickupPoint || "N/A"} → ${bus.dropPoint || "N/A"}` },
      {
        label: "Departure",
        value: bus.takeOffDate ? formatTakeoffDate(bus.takeOffDate, { withWeekday: true }) : "TBD",
      },
      { label: "Seats", value: selectedSeats.map(formatSeatLabel).join(", ") || "None" },
      { label: "Fare", value: `${selectedSeats.length} × ${formatMoney(bus.pricePerSeat)}` }
    );
  } else if (vehicle) {
    lines.push(
      { label: "Transport", value: vehicle.name },
      { label: "Route", value: `${pickupPoint || vehicle.pickupPoint || "N/A"} → ${dropPoint || vehicle.dropPoint || "N/A"}` },
      {
        label: "Reservation date",
        value: reservationDate ? formatTakeoffDate(reservationDate, { withWeekday: true }) : "N/A",
      },
      { label: "Rental type", value: "Whole vehicle" }
    );
  } else {
    lines.push({ label: "Selection", value: "No trip selected yet" });
  }

  const validPassengers = passengerRows.filter((p) => p.name.trim());
  if (validPassengers.length > 0) {
    lines.push({
      label: "Passengers",
      value: validPassengers.map((p) => p.name).join(", "),
    });
  }

  return <TripSummaryCard title="Booking Summary" lines={lines} />;
};

interface PaymentPanelProps {
  paymentMethod: "Online" | "CashOnVisit";
  setPaymentMethod: (m: "Online" | "CashOnVisit") => void;
  totalPrice: number;
  commissionAmount: number;
  vendorEarnings: number;
  processing: boolean;
  canConfirm: boolean;
  onConfirm: () => void;
  bus: Bus | null;
  vehicle: Vehicle | null;
  selectedSeats: number[];
}

const PaymentPanel = ({
  paymentMethod,
  setPaymentMethod,
  totalPrice,
  commissionAmount,
  vendorEarnings,
  processing,
  canConfirm,
  onConfirm,
  bus,
  vehicle,
  selectedSeats,
}: PaymentPanelProps) => {
  const subtotalLabel = bus
    ? `${selectedSeats.length} seat${selectedSeats.length > 1 ? "s" : ""} × ${formatMoney(bus.pricePerSeat)}`
    : vehicle
    ? "Whole vehicle"
    : "";

  return (
    <>
      <section className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
        <h2 className="mb-3 text-lg font-bold text-slate-900">Payment Method</h2>
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5">
          <button
            type="button"
            onClick={() => setPaymentMethod("Online")}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
              paymentMethod === "Online"
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-600 hover:bg-white"
            }`}
          >
            <FaCreditCard /> Pay via Khalti
          </button>
          <button
            type="button"
            onClick={() => setPaymentMethod("CashOnVisit")}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
              paymentMethod === "CashOnVisit"
                ? "bg-blue-600 text-white shadow"
                : "text-slate-600 hover:bg-white"
            }`}
          >
            <FaMoneyBillWave /> Cash on Visit
          </button>
        </div>
        {paymentMethod === "CashOnVisit" && (
          <p className="mt-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-700">
            Booking stays pending until you collect cash and confirm the payment from the Bookings section.
          </p>
        )}
        {paymentMethod === "Online" && (
          <p className="mt-3 rounded-xl bg-indigo-50 p-3 text-xs text-indigo-700">
            The customer&apos;s email is required — we will email the ticket after the Khalti payment succeeds.
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
        <h2 className="mb-3 text-lg font-bold text-slate-900">Summary</h2>
        <div className="space-y-1.5 text-sm text-slate-600">
          <div className="flex items-center justify-between">
            <span>Subtotal{subtotalLabel ? ` (${subtotalLabel})` : ""}</span>
            <span className="font-semibold text-slate-800">{formatMoney(totalPrice)}</span>
          </div>
          <div className="flex justify-between">
            <span>Platform commission (10%)</span>
            <span className="font-semibold text-slate-700">({formatMoney(commissionAmount)})</span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 pt-2">
            <span>Vendor earnings</span>
            <span className="font-semibold text-emerald-700">{formatMoney(vendorEarnings)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-2">
            <span className="font-semibold text-slate-900">Total to collect</span>
            <span className="text-xl font-bold text-slate-900">{formatMoney(totalPrice)}</span>
          </div>
        </div>
        <button
          onClick={onConfirm}
          disabled={!canConfirm || processing}
          className="mt-5 w-full rounded-xl bg-indigo-600 py-3 text-base font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {processing
            ? "Processing…"
            : !canConfirm
            ? "Complete the booking above"
            : paymentMethod === "Online"
            ? "Proceed to Payment"
            : "Confirm Booking"}
        </button>
      </section>
    </>
  );
};

export default BookTicket;