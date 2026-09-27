import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  FaUserTie,
  FaCalendarAlt,
  FaMapMarkerAlt,
  FaCheck,
  FaTimes,
  FaArrowLeft,
  FaArrowRight,
  FaChair,
  FaCreditCard,
  FaMoneyBillWave,
  FaBus,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import { bookingsApi, homeApi, API_BASE_URL, type Bus } from "../api";
import BusSeatGrid from "../Component/BusSeatGrid";
import { formatSeatLabel } from "../utils/ticket";
import { formatTakeoffDate } from "../utils/datetime";

const SeatAvailability = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [selectedBus, setSelectedBus] = useState<Bus | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [totalPrice, setTotalPrice] = useState(0);
  const [loading, setLoading] = useState(true);
  const [covSeats, setCovSeats] = useState<number[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("Online");
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchBuses = async () => {
      try {
        if (!id) return;
        const response = await homeApi.getBusById(id);
        const busData = response.bus;

        if (!busData) {
          toast.error("Bus not found.");
          setLoading(false);
          return;
        }

        busData.bookedSeats = (busData.bookedSeats || []).map(Number);
        setSelectedBus(busData);

        const covRes = await bookingsApi.getCovSeats(id);
        setCovSeats((covRes.covSeats || []).map(Number));
      } catch (error) {
        console.error("Fetch error:", error);
        showErrorToast("Failed to fetch bus data. Please try again.");
      } finally {
        setLoading(false);
      }
    };
    fetchBuses();
  }, [id]);

  const handleSeatSelection = (seatNumber: number) => {
    if (!selectedBus) return;

    if (selectedBus.bookedSeats?.includes(seatNumber)) {
      showWarningToast("This seat is already booked.");
      return;
    }

    if (covSeats.includes(seatNumber)) {
      showWarningToast("This seat is reserved for Cash on Visit.");
      return;
    }

    const isSelected = selectedSeats.includes(seatNumber);
    const newSelectedSeats = isSelected
      ? selectedSeats.filter((num) => num !== seatNumber)
      : [...selectedSeats, seatNumber];

    setSelectedSeats(newSelectedSeats);
    setTotalPrice(newSelectedSeats.length * selectedBus.pricePerSeat);
  };

  const ensureSignedIn = () => {
    if (localStorage.getItem("userId")) return true;
    showErrorToast("Please sign in to book seats and manage your ticket.");
    window.setTimeout(() => navigate("/sign-in"), 1500);
    return false;
  };

  const handleProceedToPayment = () => {
    if (!selectedBus) return;

    if (selectedSeats.length === 0) {
      showErrorToast("Please select at least one seat.");
      return;
    }

    if (!ensureSignedIn()) return;

    if (paymentMethod === "CashOnVisit") {
      showConfirmationToast();
    } else {
      navigate("/payment", {
        state: {
          busId: selectedBus._id,
          seats: selectedSeats,
          totalPrice,
        },
      });
    }
  };

  const showErrorToast = (message: string) => {
    toast.error(message, {
      position: "top-center",
      autoClose: 3000,
      className: "!bg-red-50 !text-red-800",
      progressClassName: "!bg-red-500",
    });
  };

  const showWarningToast = (message: string) => {
    toast.warning(message, {
      position: "top-center",
      autoClose: 3000,
      className: "!bg-yellow-50 !text-yellow-800",
      progressClassName: "!bg-yellow-500",
    });
  };

  const showCashOnVisitToast = (message: string) => {
    toast.info(message, {
      position: "top-center",
      autoClose: 5000,
      className: "!bg-blue-50 !text-blue-800",
      progressClassName: "!bg-blue-600",
    });
  };

  const showConfirmationToast = () => {
    if (!selectedBus) return;
    toast.dismiss();

    toast(
      <div className="w-full max-w-md p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0 pt-0.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-100">
              <FaUserTie className="h-5 w-5 text-teal-600" />
            </span>
          </div>
          <div className="ml-3 w-0 flex-1">
            <h3 className="text-lg font-medium text-gray-900">Confirm Booking</h3>
            <div className="mt-2 text-sm text-gray-600">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="font-semibold">Seats:</p>
                  <p>{selectedSeats.map(formatSeatLabel).join(", ")}</p>
                </div>
                <div>
                  <p className="font-semibold">Total:</p>
                  <p>Rs. {totalPrice}</p>
                </div>
              </div>
              <div className="mt-2">
                <p className="font-semibold">Payment Method:</p>
                <p>Cash on Visit</p>
              </div>
              <p className="mt-2 text-xs italic text-blue-600">
                * Payment will be collected when boarding. Booking stays pending
                until the vendor confirms payment at the visit.
              </p>
            </div>
            <div className="mt-4 flex space-x-3">
              <button
                onClick={confirmCashBooking}
                className="inline-flex flex-1 items-center justify-center rounded-md border border-transparent bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
              >
                <FaCheck className="mr-2" /> Confirm
              </button>
              <button
                onClick={() => toast.dismiss()}
                className="inline-flex flex-1 items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
              >
                <FaTimes className="mr-2" /> Cancel
              </button>
            </div>
          </div>
        </div>
      </div>,
      {
        position: "top-center",
        autoClose: false,
        closeButton: false,
        closeOnClick: false,
        draggable: false,
        className: "!bg-white !text-gray-900 !shadow-xl !rounded-2xl !p-0 !max-w-full",
      }
    );
  };

  const confirmCashBooking = async () => {
    if (!selectedBus) return;
    if (!ensureSignedIn()) return;
    setIsProcessing(true);
    try {
      const response = await bookingsApi.cashOnVisit({
        type: "bus",
        itemId: selectedBus._id,
        userId: localStorage.getItem("userId"),
        seats: selectedSeats,
        takeOffDate: selectedBus.takeOffDate,
      });

      toast.dismiss();
      showCashOnVisitToast(
        `Cash on Visit booking placed! Seats: ${selectedSeats
          .map(formatSeatLabel)
          .join(", ")}. Reference: ${
          (response as { bookingId?: string }).bookingId
        }. Please pay when boarding — booking is pending confirmation.`
      );

      window.setTimeout(() => {
        navigate("/my-bookings");
      }, 3000);
    } catch (err) {
      console.error("Booking error:", err);
      showErrorToast("Failed to complete booking. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <ClipLoader color="#059669" size={50} />
        <p className="text-lg font-semibold text-slate-700">Loading bus data...</p>
      </div>
    );
  }

  if (!selectedBus) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
          <FaBus className="text-2xl text-slate-400" />
        </span>
        <p className="text-lg font-semibold text-slate-700">No buses available.</p>
        <Link
          to="/tickets"
          className="rounded-xl bg-teal-600 px-6 py-3 font-semibold text-white transition hover:bg-teal-700"
        >
          Browse available buses
        </Link>
      </div>
    );
  }

  const busImage =
    selectedBus.image &&
    (selectedBus.image.startsWith("http")
      ? selectedBus.image
      : `${API_BASE_URL}${selectedBus.image}`);

  const availableCount = Math.max(
    0,
    selectedBus.totalSeats - (selectedBus.bookedSeats?.length || 0) - covSeats.length
  );

  const PAYMENT_OPTIONS = [
    { value: "Online", label: "Pay via Khalti", icon: <FaCreditCard /> },
    { value: "CashOnVisit", label: "Cash on Visit", icon: <FaMoneyBillWave /> },
  ];

  return (
    <div className="min-h-screen bg-slate-50 pb-28 lg:pb-8">
      {/* Journey header band */}
      <header className="bg-gradient-to-br from-teal-500 via-teal-600 to-slate-900 px-4 py-6 text-white sm:px-6 md:py-8">
        <div className="mx-auto max-w-6xl">
          <Link
            to="/tickets"
            className="inline-flex items-center gap-2 text-sm font-medium text-teal-100 transition hover:text-white"
          >
            <FaArrowLeft /> Back to buses
          </Link>

          <div className="mt-4 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-teal-200/80">
                Journey
              </p>
              <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{selectedBus.name}</h1>

              <div className="mt-4 flex items-center gap-3 text-teal-50">
                <span className="flex items-center gap-2 font-medium">
                  <FaMapMarkerAlt className="text-teal-300" />
                  {selectedBus.pickupPoint}
                </span>
                <FaArrowRight className="text-teal-300" />
                <span className="flex items-center gap-2 font-medium">
                  <FaMapMarkerAlt className="text-teal-300" />
                  {selectedBus.dropPoint}
                </span>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <span className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium">
                  <FaCalendarAlt className="text-teal-300" />
                  {formatTakeoffDate(selectedBus.takeOffDate)}
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium">
                  NPR {selectedBus.pricePerSeat} / seat
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium">
                  {availableCount} of {selectedBus.totalSeats} seats free
                </span>
              </div>
            </div>

            {busImage ? (
              <img
                src={busImage}
                alt={selectedBus.name}
                className="h-44 w-full rounded-2xl object-cover shadow-lg md:h-32 md:w-64"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "/default-bus-image.jpg";
                }}
              />
            ) : (
              <span className="flex h-32 w-full items-center justify-center rounded-2xl bg-white/10 md:w-64">
                <FaBus className="text-4xl text-teal-200/70" />
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="mx-auto mt-6 grid max-w-6xl gap-6 px-4 sm:px-6 lg:grid-cols-2">
        {/* Left: journey details + payment + selected seats */}
        <div className="space-y-6">
          <section className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
            <h2 className="mb-4 text-lg font-bold text-slate-900 sm:text-xl">Journey Details</h2>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-teal-100">
                  <FaCalendarAlt className="text-teal-600" />
                </span>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Trip Date
                </p>
                <p className="mt-1 font-semibold text-slate-900">
                  {formatTakeoffDate(selectedBus.takeOffDate)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-blue-100">
                  <FaMapMarkerAlt className="text-blue-600" />
                </span>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Pickup
                </p>
                <p className="mt-1 font-semibold text-slate-900">{selectedBus.pickupPoint}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-rose-100">
                  <FaMapMarkerAlt className="text-rose-500" />
                </span>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Drop
                </p>
                <p className="mt-1 font-semibold text-slate-900">{selectedBus.dropPoint}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
            <h2 className="mb-3 text-lg font-bold text-slate-900 sm:text-xl">Payment Method</h2>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5">
              {PAYMENT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPaymentMethod(option.value)}
                  className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    paymentMethod === option.value
                      ? "bg-teal-600 text-white shadow"
                      : "text-slate-600 hover:bg-white"
                  }`}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
            <div className="mb-3 flex items-center gap-2">
              <FaChair className="text-lg text-teal-600" />
              <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Selected Seats</h2>
            </div>

            {selectedSeats.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                No seats selected yet — tap seats on the bus map to choose.
              </div>
            ) : (
              <div className="rounded-xl bg-teal-50/60 p-3">
                <div className="flex flex-wrap gap-2">
                  {selectedSeats.map((seatNumber) => (
                    <button
                      key={seatNumber}
                      onClick={() => handleSeatSelection(seatNumber)}
                      title="Deselect seat"
                      className="group flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition hover:bg-rose-500"
                    >
                      {formatSeatLabel(seatNumber)}
                      <FaTimes className="hidden text-xs text-teal-100 group-hover:block" />
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-teal-200 pt-3">
                  <span className="flex items-baseline gap-1 text-sm text-slate-600">
                    {selectedSeats.length} seat{selectedSeats.length > 1 ? "s" : ""} × NPR{" "}
                    {selectedBus.pricePerSeat}
                  </span>
                  <span className="text-xl font-bold text-slate-900">
                    NPR {totalPrice}
                  </span>
                </div>
              </div>
            )}

            <button
              onClick={handleProceedToPayment}
              disabled={isProcessing}
              className="mt-4 hidden w-full rounded-xl bg-teal-600 py-3 text-base font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60 lg:block"
            >
              Continue to Payment
              {selectedSeats.length > 0 && ` (${selectedSeats.length} seat${selectedSeats.length > 1 ? "s" : ""})`}
            </button>
          </section>
        </div>

        {/* Right: seat map */}
        <BusSeatGrid
          bus={selectedBus}
          selectedSeats={selectedSeats}
          covSeats={covSeats}
          onToggle={handleSeatSelection}
        />
      </div>

      {/* Sticky mobile checkout bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <p className="text-xs text-slate-500">
              {selectedSeats.length} seat{selectedSeats.length === 1 ? "" : "s"} selected
            </p>
            <p className="text-lg font-bold text-slate-900">NPR {totalPrice}</p>
          </div>
          <button
            onClick={handleProceedToPayment}
            disabled={isProcessing}
            className="rounded-xl bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow-md transition hover:bg-teal-700 disabled:opacity-60"
          >
            Continue to Payment
          </button>
        </div>
      </div>
    </div>
  );
};

export default SeatAvailability;