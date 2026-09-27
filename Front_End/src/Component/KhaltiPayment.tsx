import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import { bookingsApi } from "../api";

interface PaymentState {
  busId?: string;
  seats?: number[];
  totalPrice?: number;
}

const Payment = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { busId, seats, totalPrice } = (location.state || {}) as PaymentState;

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!busId || !seats || seats.length === 0 || !totalPrice) {
      toast.error("Invalid payment details. Redirecting...");
      navigate("/");
    }
  }, [busId, seats, totalPrice, navigate]);

  const handlePayment = async () => {
    setLoading(true);

    try {
      const userId = localStorage.getItem("userId");

      if (!userId) {
        toast.error("Please sign in to book seats and manage your ticket.");
        setLoading(false);
        window.setTimeout(() => navigate("/sign-in"), 1500);
        return;
      }

      const response = await bookingsApi.initiatePayment({
        type: "bus",
        itemId: busId,
        seats,
        userId,
      });

      if (response.payment_url) {
        window.location.href = response.payment_url;
      } else {
        toast.error("No payment URL received.");
      }
    } catch (err) {
      const axiosErr = err as { response?: { data?: { message?: string } }; message?: string };
      console.error("Payment Error:", axiosErr.response?.data || axiosErr.message);
      toast.error(axiosErr.response?.data?.message || "Payment failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-blue-50 p-6">
      <h1 className="mb-4 text-2xl font-bold text-slate-900 sm:text-3xl">
        Confirm Your Payment
      </h1>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-card-lg">
        <p className="mb-3 text-lg text-slate-700">
          Seats Selected: {seats?.join(", ")}
        </p>
        <p className="mb-3 text-lg text-slate-700">
          Total Price: Rs. {totalPrice}
        </p>
        <button
          onClick={handlePayment}
          className="mt-4 w-full rounded-xl bg-blue-600 py-3 text-lg font-semibold text-white transition-colors hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
          disabled={loading}
        >
          {loading ? <ClipLoader color="#fff" size={20} /> : "Proceed to Khalti Payment"}
        </button>
      </div>
    </div>
  );
};

export default Payment;