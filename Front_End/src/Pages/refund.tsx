import { useEffect, useState, useCallback } from "react";
import { toast } from "react-toastify";
import { FaQrcode, FaMoneyBillWave, FaArrowLeft } from "react-icons/fa";
import { ImSpinner8 } from "react-icons/im";
import { MdEventSeat, MdDirectionsBus, MdDirectionsCar } from "react-icons/md";
import { BsCalendarDate, BsCashCoin } from "react-icons/bs";
import { refundsApi, type Booking } from "../api";
import { bookingNumberOf } from "../utils/ticket";
import { formatTakeoffDateTime, toDate } from "../utils/datetime";

const refName = (ref: string | { name?: string } | undefined, fallback = "") =>
  typeof ref === "object" && ref ? ref.name : fallback;

const Refunds = () => {
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const userId = localStorage.getItem("userId");

  const fetchBookings = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const data = await refundsApi.getUpcoming(userId);
      setUpcomingBookings(data || []);
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.error(axiosErr.response?.data?.message || "Failed to fetch upcoming bookings.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) fetchBookings();
  }, [userId, fetchBookings]);

  const handleRefundRequest = async () => {
    if (!selectedBooking) return;
    if (!reason.trim()) {
      return toast.error("Please enter a refund reason.");
    }

    setIsSubmitting(true);
    try {
      await refundsApi.requestByBookingId(selectedBooking._id, reason);

      toast.success("Refund request submitted for admin approval.");
      setSelectedBooking(null);
      setReason("");
      fetchBookings();
    } catch (error) {
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.error(axiosErr.response?.data?.message || "Failed to submit refund request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const calculateRefundAmount = (booking: Booking) => {
    return (booking.totalPrice || 0) * 0.8;
  };

  const getTransportIcon = (booking: Booking) =>
    booking.busId ? (
      <MdDirectionsBus className="text-lg text-blue-400" />
    ) : (
      <MdDirectionsCar className="text-lg text-blue-400" />
    );

  return (
    <div className="min-h-screen bg-[#f0f4f8] px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-8 flex items-center gap-3 text-3xl font-extrabold text-slate-900">
          <FaQrcode className="text-slate-900" />
          Refunds
        </h1>

        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center">
            <ImSpinner8 className="mb-4 animate-spin text-4xl text-blue-500" />
            <p className="text-lg text-slate-500">Loading your bookings...</p>
          </div>
        ) : !selectedBooking ? (
          <>
            {upcomingBookings.length === 0 ? (
              <div className="rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center text-white shadow-card">
                <FaMoneyBillWave className="mx-auto mb-4 text-4xl text-blue-400" />
                <h3 className="mb-2 text-xl font-semibold">
                  No bookings eligible for refund
                </h3>
                <p className="text-slate-400">
                  You currently don&apos;t have any upcoming bookings that qualify for
                  refunds.
                </p>
              </div>
            ) : (
              <div className="grid gap-6">
                {upcomingBookings.map((booking) => {
                  const isBus = !!booking.busId;
                  const title = refName(
                    isBus ? booking.busId : booking.vehicleId,
                    "Reserved Vehicle"
                  );
                  const departure =
                    toDate(booking.takeOffDate) || toDate(booking.reservationDate);
                  const takeOff = departure ? formatTakeoffDateTime(departure) : "N/A";
                  const estimatedRefund = calculateRefundAmount(booking);

                  return (
                    <div
                      key={booking._id}
                      className="flex flex-col justify-between gap-6 rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white shadow-card md:flex-row md:items-center"
                    >
                      <div className="flex items-start gap-4">
                        <div className="rounded-xl bg-slate-800 p-3">
                          {getTransportIcon(booking)}
                        </div>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <h2 className="text-xl font-bold">{title}</h2>
                            <span className="rounded-full bg-blue-900 px-2 py-1 text-xs text-blue-200">
                              Est. refund: NPR {estimatedRefund.toFixed(2)}
                            </span>
                          </div>
                          <p className="text-sm text-slate-400">
                            Booking No: {bookingNumberOf(booking)}
                          </p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                            <p className="flex items-center gap-1 text-slate-400">
                              <MdEventSeat />
                              Seats: {booking.selectedSeats?.join(", ") || "N/A"}
                            </p>
                            <p className="flex items-center gap-1 text-slate-400">
                              <BsCashCoin />
                              Total: NPR {booking.totalPrice}
                            </p>
                            <p className="flex items-center gap-1 text-slate-400">
                              <BsCalendarDate />
                              Departure: {takeOff}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col md:items-end">
                        <button
                          onClick={() => setSelectedBooking(booking)}
                          className="rounded-xl bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800"
                        >
                          Request Refund
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="mx-auto max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white shadow-card-lg">
            <button
              onClick={() => setSelectedBooking(null)}
              className="mb-4 flex items-center gap-2 text-slate-400 hover:text-white"
            >
              <FaArrowLeft />
              <span>Back to bookings</span>
            </button>

            <h3 className="mb-4 text-xl font-semibold">Submit Refund Request</h3>

            <div className="mb-6">
              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-800 p-3">
                  <p className="text-sm text-slate-400">Original Amount</p>
                  <p className="font-medium">NPR {selectedBooking.totalPrice}</p>
                </div>
                <div className="rounded-xl border border-blue-800 bg-blue-900/30 p-3">
                  <p className="text-sm text-blue-300">Estimated Refund</p>
                  <p className="font-medium text-blue-200">
                    NPR {calculateRefundAmount(selectedBooking).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            <div className="mb-6">
              <label className="mb-2 block text-slate-400">
                Reason for Refund <span className="text-red-400">*</span>
              </label>
              <textarea
                className="h-32 w-full resize-none rounded-xl border border-slate-600 bg-slate-800 p-3 text-white placeholder-slate-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Please explain why you're requesting a refund..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                Provide details to help us process your request faster.
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setSelectedBooking(null);
                  setReason("");
                }}
                className="rounded-xl bg-slate-700 px-4 py-2 transition hover:bg-slate-600"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                onClick={handleRefundRequest}
                className="rounded-xl bg-blue-700 px-4 py-2 transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={!reason.trim() || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <ImSpinner8 className="mr-2 inline animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Submit Refund"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Refunds;