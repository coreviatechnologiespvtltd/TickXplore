import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { ExclamationCircleIcon } from "@heroicons/react/24/outline";
import { usersApi, type RegisterPayload } from "../api";

const Registration = () => {
  const [role, setRole] = useState<"user" | "vendor">("user");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [vendorLocation, setVendorLocation] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [showOTPModal, setShowOTPModal] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [registrationData, setRegistrationData] = useState<{ userId?: string; email?: string } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name || !location || !phoneNumber || !email || !password || !confirmPassword || !role) {
      return setError("All fields are required.");
    }

    if (password !== confirmPassword) {
      return setError("Passwords do not match.");
    }

    setIsLoading(true);

    const data: RegisterPayload = {
      name,
      location,
      email,
      phoneNumber,
      password,
      confirmPassword,
      role,
    };

    if (role === "vendor") {
      data.vendorName = vendorName;
      data.vendorLocation = vendorLocation;
    }

    try {
      const response = await usersApi.register(data);

      setRegistrationData({
        userId: (response as { user?: { _id?: string } })?.user?._id,
        email: (response as { user?: { email?: string } })?.user?.email,
      });

      setShowOTPModal(true);
      setIsLoading(false);

      toast.success("OTP sent to your email. Please verify.");
    } catch (err) {
      setIsLoading(false);
      const axiosErr = err as { response?: { data?: { message?: string } } };
      if (axiosErr.response?.data?.message) {
        setError(axiosErr.response.data.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    }
  };

  const handleOTPVerification = async () => {
    if (!otp || otp.length !== 6) {
      return setOtpError("Please enter a valid 6-digit OTP");
    }

    if (!registrationData?.userId) {
      return setOtpError("User ID is missing.");
    }

    setIsVerifying(true);
    setOtpError("");

    try {
      await usersApi.verifyOtp({ userId: registrationData.userId, otp });

      toast.success("Account verified successfully!");
      window.setTimeout(() => {
        navigate("/sign-in");
      }, 1500);
    } catch (err) {
      setIsVerifying(false);
      const axiosErr = err as { response?: { data?: { message?: string } } };
      if (axiosErr.response?.data?.message) {
        setOtpError(axiosErr.response.data.message);
      } else {
        setOtpError("OTP verification failed. Please try again.");
      }
    }
  };

  const resendOTP = async () => {
    try {
      await usersApi.resendOtp({
        userId: registrationData?.userId ?? "",
        email: registrationData?.email ?? "",
      });
      toast.success("New OTP sent successfully!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to resend OTP. Please try again.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-blue-50 p-4">
      {showOTPModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-card-lg">
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                <ExclamationCircleIcon className="h-6 w-6 text-blue-600" />
              </div>
              <h3 className="mt-3 text-lg font-medium text-slate-900">Verify Your Account</h3>
              <div className="mt-2 text-sm text-slate-500">
                <p>We&apos;ve sent a 6-digit OTP to {registrationData?.email}. Please enter it below.</p>
              </div>
            </div>

            <div className="mt-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-slate-700">OTP Code</label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  maxLength={6}
                  className="input-field"
                  placeholder="123456"
                  disabled={isVerifying}
                />
              </div>

              {otpError && (
                <div className="mt-2 flex items-center rounded border-l-4 border-red-500 bg-red-50 p-2">
                  <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
                  <p className="ml-2 text-sm text-red-700">{otpError}</p>
                </div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <button
                  onClick={resendOTP}
                  className="text-sm font-medium text-blue-600 hover:text-blue-500"
                >
                  Resend OTP
                </button>

                <button
                  onClick={handleOTPVerification}
                  className={`rounded-lg px-4 py-2 text-white ${isVerifying ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"}`}
                  disabled={isVerifying}
                >
                  {isVerifying ? "Verifying..." : "Verify"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-md space-y-6 rounded-2xl bg-white p-8 shadow-card-lg">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-slate-900">Create an Account</h2>
          <p className="mt-2 text-slate-500">Join our platform today</p>
        </div>

        {error && (
          <div className="flex items-center rounded border-l-4 border-red-500 bg-red-50 p-3">
            <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
            <p className="ml-2 text-sm text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">Full Name*</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              placeholder="John Doe"
              disabled={isLoading}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">Location*</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="input-field"
              placeholder="Your city"
              disabled={isLoading}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">Phone Number*</label>
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="input-field"
              placeholder="1234567890"
              disabled={isLoading}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">Email*</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="your@email.com"
              disabled={isLoading}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Account Type*</label>
            <div className="grid grid-cols-2 gap-3">
              {(["user", "vendor"] as const).map((r) => (
                <div
                  key={r}
                  onClick={() => setRole(r)}
                  className={`cursor-pointer rounded-xl border p-3 text-center transition ${
                    role === r ? "border-blue-500 bg-blue-50" : "border-slate-300 hover:border-slate-400"
                  }`}
                >
                  <div className="text-sm font-medium capitalize text-slate-800">{r}</div>
                </div>
              ))}
            </div>
          </div>

          {role === "vendor" && (
            <>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-slate-700">Vendor Name*</label>
                <input
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  className="input-field"
                  placeholder="Business name"
                  disabled={isLoading}
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="block text-sm font-medium text-slate-700">Vendor Location*</label>
                <input
                  value={vendorLocation}
                  onChange={(e) => setVendorLocation(e.target.value)}
                  className="input-field"
                  placeholder="Business address"
                  disabled={isLoading}
                  required
                />
              </div>
            </>
          )}

          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">Password*</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              disabled={isLoading}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">Confirm Password*</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input-field"
              disabled={isLoading}
              required
            />
          </div>

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={isLoading}
          >
            {isLoading ? "Registering..." : "Register Now"}
          </button>
        </form>

        <div className="text-center text-sm text-slate-600">
          Already have an account?{" "}
          <button onClick={() => navigate("/sign-in")} className="font-medium text-blue-600 hover:text-blue-500">
            Sign in
          </button>
        </div>

        <div className="rounded-lg bg-blue-50 p-3 text-center text-sm text-slate-700">
          Own a hotel or guest house?{" "}
          <button
            onClick={() => navigate("/hotelregistration")}
            className="font-medium text-blue-600 hover:text-blue-500"
          >
            Register your property
          </button>
        </div>
      </div>
    </div>
  );
};

export default Registration;