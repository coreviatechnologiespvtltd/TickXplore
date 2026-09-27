import { useState, useEffect, type ReactNode } from "react";
import { toast } from "react-toastify";
import { FiCalendar, FiArrowRight, FiRefreshCw } from "react-icons/fi";
import { useParams, useNavigate } from "react-router-dom";
import { homeApi, bookingsApi, API_BASE_URL } from "../api";
import type { Vehicle } from "../api/types";
import { dateKey } from "../utils/datetime";

interface VehicleWithAvailability extends Vehicle {
  isAvailable: boolean;
}

const VehicleReservation = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState<VehicleWithAvailability[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleWithAvailability | null>(null);
  const [takeOffDate, setTakeOffDate] = useState("");
  const [pickupPoint, setPickupPoint] = useState("");
  const [dropPoint, setDropPoint] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"online" | "cash">("online");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVehicles();
     
  }, []);

  useEffect(() => {
    if (id) fetchVehicleById(id);
     
  }, [id]);

  const fetchVehicles = async () => {
    setLoading(true);
    try {
      const content = await homeApi.getVehicles();
      const allVehicles = (content.vehicles || content.data || []) as Vehicle[];

      const withAvailability = await Promise.all(
        allVehicles.map(async (vehicle) => {
          const reservations = await bookingsApi.getReservationsByVehicle(vehicle._id);
          return { ...vehicle, isAvailable: reservations.length === 0 };
        })
      );

      setVehicles(withAvailability);
      setSelectedVehicle((prev) => prev ?? withAvailability[0] ?? null);
    } catch (error) {
      console.error(error);
      toast.error("Failed to fetch vehicles. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const fetchVehicleById = async (vehicleId: string) => {
    setLoading(true);
    try {
      const response = await homeApi.getVehicleById(vehicleId);
      const reservations = await bookingsApi.getReservationsByVehicle(vehicleId);
      const isAvailable = reservations.length === 0;
      setSelectedVehicle({ ...response.vehicle, isAvailable });
    } catch (error) {
      console.error(error);
      toast.error("Failed to fetch vehicle details.");
    } finally {
      setLoading(false);
    }
  };

  const checkAvailabilityBeforeBooking = async () => {
    if (!selectedVehicle) return false;
    try {
      const res = await bookingsApi.getReservationsByVehicle(selectedVehicle._id);
      if (res.length > 0) {
        toast.error("This vehicle just got reserved. Please choose another.");
        fetchVehicles();
        return false;
      }
      return true;
    } catch (error) {
      console.error(error);
      toast.error("Could not verify vehicle availability.");
      return false;
    }
  };

  const handlePaymentAndReservation = async () => {
    const userId = localStorage.getItem("userId");
    if (!userId) {
      toast.error("Please sign in to book seats and manage your ticket.");
      window.setTimeout(() => navigate("/sign-in"), 1500);
      return;
    }

    if (!selectedVehicle || !takeOffDate || !pickupPoint || !dropPoint) {
      toast.error("Please fill all required fields.");
      return;
    }

    const available = await checkAvailabilityBeforeBooking();
    if (!available) return;

    try {
      const payload = {
        type: "vehicle",
        itemId: selectedVehicle._id,
        takeOffDate,
        pickupPoint,
        dropPoint,
        userId,
      };

      if (paymentMethod === "online") {
        const paymentResponse = await bookingsApi.initiatePayment(payload);

        if (paymentResponse.payment_url) {
          window.location.href = paymentResponse.payment_url;
        } else {
          toast.error("Payment initiation failed.");
        }
      } else {
        const response = await bookingsApi.cashOnVisit(payload);
        if ((response as { message?: string }).message) {
          toast.success((response as { message: string }).message);
          navigate("/my-bookings");
        } else {
          toast.error("Reservation failed. Please try again.");
        }
      }
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.error(axiosErr.response?.data?.message || "Failed to process reservation.");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!selectedVehicle && vehicles.length === 0) {
    return (
      <div className="min-h-screen py-12 text-center">
        <div className="mx-auto max-w-2xl px-4">
          <div className="rounded-2xl bg-white p-6 shadow-card sm:p-8">
            <h2 className="mb-4 text-xl font-bold text-slate-800 sm:text-2xl">
              No Available Vehicles
            </h2>
            <p className="mb-4 text-slate-600">
              All our vehicles are currently reserved. Please check back later.
            </p>
            <button
              onClick={fetchVehicles}
              className="mx-auto flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600 sm:px-6"
            >
              <FiRefreshCw /> Refresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-blue-50 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-2xl bg-white p-6 shadow-card-lg sm:p-8">
          <div className="mb-6 flex items-center justify-between sm:mb-8">
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
              Vehicle Reservation
            </h1>
            <button
              onClick={fetchVehicles}
              className="rounded-xl bg-slate-100 p-2 transition-colors hover:bg-slate-200"
              title="Refresh vehicles"
              aria-label="Refresh vehicles"
            >
              <FiRefreshCw className="h-5 w-5 text-slate-600" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-2">
            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Select Vehicle
                </label>
                <select
                  className="input-field"
                  onChange={(e) => {
                    const selectedId = e.target.value;
                    const vehicle = vehicles.find((v) => v._id === selectedId);
                    setSelectedVehicle(vehicle || null);
                  }}
                  value={selectedVehicle?._id || ""}
                >
                  <option value="" disabled>
                    Select a Vehicle
                  </option>
                  {vehicles.map((vehicle) => (
                    <option key={vehicle._id} value={vehicle._id} disabled={!vehicle.isAvailable}>
                      {vehicle.name} - {vehicle.totalSeats || vehicle.capacity} seats
                      {!vehicle.isAvailable && " (Booked)"}
                    </option>
                  ))}
                </select>
              </div>

              {selectedVehicle && (
                <div className="space-y-4 rounded-2xl bg-slate-50 p-4 sm:p-6">
                  <div className="aspect-video overflow-hidden rounded-xl bg-slate-200">
                    <img
                      src={
                        selectedVehicle.image
                          ? selectedVehicle.image.startsWith("http")
                            ? selectedVehicle.image
                            : `${API_BASE_URL}${selectedVehicle.image}`
                          : "/default-vehicle.jpg"
                      }
                      alt={selectedVehicle.name}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/default-vehicle.jpg";
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <DetailItem label="Vehicle Name" value={selectedVehicle.name} />
                    <DetailItem
                      label="Capacity"
                      value={`${selectedVehicle.totalSeats || selectedVehicle.capacity} seats`}
                    />
                    <DetailItem label="Price" value={`Rs. ${selectedVehicle.price}`} />
                    <DetailItem
                      label="Status"
                      value={
                        <span
                          className={`font-semibold ${
                            selectedVehicle.isAvailable ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {selectedVehicle.isAvailable ? "Available" : "Booked"}
                        </span>
                      }
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div className="rounded-2xl border-2 border-blue-100 bg-blue-50 p-4 sm:p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-blue-800">
                  <FiCalendar className="h-5 w-5" /> Reservation Details
                </h3>

                <div className="space-y-4">
                  <input
                    type="date"
                    className="input-field"
                    value={takeOffDate}
                    onChange={(e) => setTakeOffDate(e.target.value)}
                    min={dateKey(new Date())}
                  />
                  <input
                    type="text"
                    placeholder="Pickup Location"
                    className="input-field"
                    value={pickupPoint}
                    onChange={(e) => setPickupPoint(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Drop-off Location"
                    className="input-field"
                    value={dropPoint}
                    onChange={(e) => setDropPoint(e.target.value)}
                  />

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Payment Method
                    </label>
                    <div className="flex space-x-4">
                      <button
                        onClick={() => setPaymentMethod("online")}
                        className={`flex-1 rounded-xl border-2 p-3 ${
                          paymentMethod === "online"
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        Online (Khalti)
                      </button>
                      <button
                        onClick={() => setPaymentMethod("cash")}
                        className={`flex-1 rounded-xl border-2 p-3 ${
                          paymentMethod === "cash"
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        Cash on Visit
                      </button>
                    </div>
                  </div>

                  {paymentMethod === "cash" && (
                    <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                      <p className="font-medium">Cash on Visit Instructions:</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        <li>You&apos;ll pay cash when you receive the vehicle</li>
                        <li>Please bring the exact amount if possible</li>
                        <li>You&apos;ll get confirmation email from TickXplore</li>
                        <li>Booking remains pending until payment</li>
                      </ul>
                    </div>
                  )}

                  <button
                    onClick={handlePaymentAndReservation}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 font-medium text-white transition-colors ${
                      paymentMethod === "online"
                        ? "bg-blue-600 hover:bg-blue-700"
                        : "bg-emerald-600 hover:bg-emerald-700"
                    }`}
                    disabled={!selectedVehicle?.isAvailable}
                  >
                    Confirm Reservation
                    <FiArrowRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface DetailItemProps {
  label: string;
  value: ReactNode;
}

const DetailItem = ({ label, value }: DetailItemProps) => (
  <div className="flex items-center justify-between">
    <span className="font-medium text-slate-600">{label}:</span>
    <span className="font-semibold text-slate-900">{value}</span>
  </div>
);

export default VehicleReservation;