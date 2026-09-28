import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  BuildingOffice2Icon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  MapPinIcon,
} from "@heroicons/react/24/outline";
import { ACCOMMODATION_TYPES, hotelApi, usersApi, type AmenityEntry } from "../api";
import type { RegisterPayload } from "../api";

/**
 * Hotel registration.
 *
 * Separate from `/signup` because a hotel account is not a user account: it is
 * created inactive and stays invisible on the public site until an admin both
 * activates the account and approves the listing.
 *
 * The optional "property details" block seeds the listing so the dashboard does
 * not open on a blank form. Everything here mirrors what the backend accepts —
 * see the hotel branch of `authController.register`.
 */

interface FormState {
  /* account */
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
  /* property */
  hotelName: string;
  city: string;
  district: string;
  area: string;
  address: string;
  type: string;
  starRating: number;
  description: string;
  latitude: string;
  longitude: string;
  amenities: string[];
}

const EMPTY: FormState = {
  name: "",
  email: "",
  phoneNumber: "",
  password: "",
  confirmPassword: "",
  hotelName: "",
  city: "",
  district: "",
  area: "",
  address: "",
  type: "Hotel",
  starRating: 3,
  description: "",
  latitude: "",
  longitude: "",
  amenities: [],
};

const HotelRegistration = () => {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [catalog, setCatalog] = useState<AmenityEntry[]>([]);
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [registered, setRegistered] = useState<{ userId: string; email: string } | null>(null);

  const navigate = useNavigate();

  /* The amenity catalog is public, so the form can offer it before sign-in. */
  useEffect(() => {
    let active = true;
    hotelApi
      .amenities("hotel")
      .then((entries) => {
        if (active) setCatalog(entries);
      })
      .catch(() => {
        /* Amenities are a nice-to-have here; the form still submits without them. */
      });
    return () => {
      active = false;
    };
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const grouped = useMemo(() => {
    return catalog.reduce<Record<string, AmenityEntry[]>>((acc, entry) => {
      (acc[entry.category] ||= []).push(entry);
      return acc;
    }, {});
  }, [catalog]);

  const toggleAmenity = (key: string) =>
    setForm((prev) => ({
      ...prev,
      amenities: prev.amenities.includes(key)
        ? prev.amenities.filter((k) => k !== key)
        : [...prev.amenities, key],
    }));

  /* ------------------------------ validation ------------------------------ */

  /** Mirrors the server's rules so obvious mistakes never need a round trip. */
  const validate = (): string => {
    if (!form.name.trim()) return "Please enter your full name.";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return "Please enter a valid email address.";

    // The schema is /^[0-9]{7,15}$/ — digits only, no +, spaces or dashes.
    const digits = form.phoneNumber.trim();
    if (!/^\d{7,15}$/.test(digits)) {
      return "Phone number must be 7 to 15 digits, numbers only (no + or dashes).";
    }

    if (form.password.length < 6) return "Password must be at least 6 characters.";
    if (form.password !== form.confirmPassword) return "Passwords do not match.";

    if (!form.hotelName.trim()) return "Please enter your property name.";
    if (form.hotelName.trim().length > 150) return "Property name must be 150 characters or fewer.";
    if (!form.city.trim()) return "Please enter the city or town the property is in.";
    if (form.description.trim().length > 6000) {
      return "Description must be 6000 characters or fewer.";
    }
    if (form.starRating < 1 || form.starRating > 5) return "Star rating must be between 1 and 5.";

    const hasLat = form.latitude.trim() !== "";
    const hasLng = form.longitude.trim() !== "";
    if (hasLat !== hasLng) return "Enter both latitude and longitude, or leave both blank.";

    if (hasLat) {
      const lat = Number(form.latitude);
      const lng = Number(form.longitude);
      if (Number.isNaN(lat) || lat < -90 || lat > 90) return "Latitude must be between -90 and 90.";
      if (Number.isNaN(lng) || lng < -180 || lng > 180) {
        return "Longitude must be between -180 and 180.";
      }
    }

    return "";
  };

  /* -------------------------------- submit -------------------------------- */

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const problem = validate();
    if (problem) return setError(problem);

    setIsLoading(true);

    const hasGeo = form.latitude.trim() !== "";
    const payload: RegisterPayload = {
      role: "hotel",
      name: form.name.trim(),
      // `location` is required by the shared register handler but is not stored
      // on the Hotel model, so it mirrors the city rather than asking twice.
      location: form.city.trim(),
      email: form.email.trim(),
      phoneNumber: form.phoneNumber.trim(),
      password: form.password,
      confirmPassword: form.confirmPassword,
      hotelName: form.hotelName.trim(),
      hotelLocation: form.city.trim(),
      type: form.type as RegisterPayload["type"],
      starRating: form.starRating,
      amenities: form.amenities,
    };

    if (form.description.trim()) payload.description = form.description.trim();
    if (form.address.trim()) payload.address = form.address.trim();
    if (form.area.trim()) payload.area = form.area.trim();
    if (form.district.trim()) payload.district = form.district.trim();
    if (hasGeo) {
      payload.latitude = Number(form.latitude);
      payload.longitude = Number(form.longitude);
    }

    try {
      const response = await usersApi.register(payload);

      setRegistered({ userId: response.user._id, email: response.user.email });
      setShowOTPModal(true);
      toast.success("OTP sent to your email. Please verify.");
    } catch (err) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setError(axiosErr.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  /* ------------------------------- OTP flow ------------------------------- */

  const handleOTPVerification = async () => {
    if (!/^\d{6}$/.test(otp)) return setOtpError("Please enter the 6-digit code from your email.");

    setIsVerifying(true);
    setOtpError("");

    try {
      await usersApi.verifyOtp({ userId: registered!.userId, otp });
      toast.success("Email verified. An admin will activate your account shortly.");
      setShowOTPModal(false);
      setTimeout(() => navigate("/sign-in"), 2000);
    } catch (err) {
      setIsVerifying(false);
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setOtpError(axiosErr.response?.data?.message || "Verification failed. Please try again.");
    }
  };

  const resendOTP = async () => {
    if (!registered) return;
    setIsResending(true);
    try {
      await usersApi.resendOtp({ userId: registered.userId, email: registered.email });
      toast.success("A new OTP is on its way.");
    } catch {
      toast.error("Could not resend the OTP. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

  /* --------------------------------- view --------------------------------- */

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-blue-50 px-4 py-10">
      {showOTPModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-card-lg">
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                <ExclamationCircleIcon className="h-6 w-6 text-blue-600" />
              </div>
              <h3 className="mt-3 text-lg font-medium text-slate-900">Verify your email</h3>
              <p className="mt-2 text-sm text-slate-500">
                We sent a 6-digit code to {registered?.email}. Enter it below to continue.
              </p>
            </div>

            <div className="mt-4 space-y-1">
              <label className="block text-sm font-medium text-slate-700">OTP Code</label>
              <input
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                className="input-field"
                placeholder="123456"
                disabled={isVerifying}
              />
            </div>

            {otpError && (
              <div className="mt-2 flex items-center rounded border-l-4 border-red-500 bg-red-50 p-2">
                <ExclamationCircleIcon className="h-5 w-5 shrink-0 text-red-500" />
                <p className="ml-2 text-sm text-red-700">{otpError}</p>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={resendOTP}
                disabled={isResending}
                className="text-sm font-medium text-blue-600 hover:text-blue-500 disabled:opacity-50"
              >
                {isResending ? "Sending..." : "Resend OTP"}
              </button>
              <button
                onClick={handleOTPVerification}
                disabled={isVerifying}
                className={`rounded-lg px-4 py-2 text-white ${
                  isVerifying ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {isVerifying ? "Verifying..." : "Verify"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-2xl bg-white p-8 shadow-card-lg">
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
              <BuildingOffice2Icon className="h-6 w-6 text-blue-600" />
            </div>
            <h1 className="mt-4 text-3xl font-bold text-slate-900">List your property</h1>
            <p className="mt-2 text-slate-500">
              Create a hotel account to manage your rooms, prices and availability.
            </p>
          </div>

          {error && (
            <div className="mt-6 flex items-start rounded border-l-4 border-red-500 bg-red-50 p-3">
              <ExclamationCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
              <p className="ml-2 text-sm text-red-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-8">
            {/* ----------------------------- account ----------------------------- */}
            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Account details
              </legend>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="hr-name" className="block text-sm font-medium text-slate-700">
                    Full Name*
                  </label>
                  <input
                    id="hr-name"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    className="input-field"
                    placeholder="John Doe"
                    disabled={isLoading}
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="hr-email" className="block text-sm font-medium text-slate-700">
                    Email*
                  </label>
                  <input
                    id="hr-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    className="input-field"
                    placeholder="you@hotel.com"
                    disabled={isLoading}
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="hr-phone" className="block text-sm font-medium text-slate-700">
                    Phone Number*
                  </label>
                  <input
                    id="hr-phone"
                    type="tel"
                    inputMode="numeric"
                    value={form.phoneNumber}
                    onChange={(e) => set("phoneNumber", e.target.value.replace(/\D/g, "").slice(0, 15))}
                    className="input-field"
                    placeholder="9812345678"
                    disabled={isLoading}
                    required
                  />
                  <p className="text-xs text-slate-500">Digits only, 7 to 15 numbers.</p>
                </div>

                <div className="space-y-1">
                  <label htmlFor="hr-password" className="block text-sm font-medium text-slate-700">
                    Password*
                  </label>
                  <input
                    id="hr-password"
                    type="password"
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    className="input-field"
                    placeholder="At least 6 characters"
                    disabled={isLoading}
                    required
                    minLength={6}
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label
                    htmlFor="hr-confirm"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Confirm Password*
                  </label>
                  <input
                    id="hr-confirm"
                    type="password"
                    value={form.confirmPassword}
                    onChange={(e) => set("confirmPassword", e.target.value)}
                    className="input-field"
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>
            </fieldset>

            {/* ---------------------------- property ---------------------------- */}
            <fieldset className="space-y-4 border-t border-slate-200 pt-6">
              <legend className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Property details
              </legend>
              <p className="text-sm text-slate-500">
                Optional, but it saves you filling in the same details again later. You can change
                everything from your dashboard before the listing goes live.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="hr-hotel" className="block text-sm font-medium text-slate-700">
                    Property Name*
                  </label>
                  <input
                    id="hr-hotel"
                    value={form.hotelName}
                    onChange={(e) => set("hotelName", e.target.value)}
                    className="input-field"
                    placeholder="Pokhara Lakeside Retreat"
                    maxLength={150}
                    disabled={isLoading}
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="hr-city" className="block text-sm font-medium text-slate-700">
                    City / Town*
                  </label>
                  <input
                    id="hr-city"
                    value={form.city}
                    onChange={(e) => set("city", e.target.value)}
                    className="input-field"
                    placeholder="Pokhara"
                    maxLength={100}
                    disabled={isLoading}
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="hr-type" className="block text-sm font-medium text-slate-700">
                    Property Type
                  </label>
                  <select
                    id="hr-type"
                    value={form.type}
                    onChange={(e) => set("type", e.target.value)}
                    className="input-field"
                    disabled={isLoading}
                  >
                    {ACCOMMODATION_TYPES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-sm font-medium text-slate-700">Star Rating</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => set("starRating", star)}
                        disabled={isLoading}
                        aria-label={`${star} star${star > 1 ? "s" : ""}`}
                        aria-pressed={form.starRating === star}
                        className={`flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-medium transition ${
                          form.starRating === star
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-slate-300 text-slate-500 hover:border-slate-400"
                        }`}
                      >
                        {star}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor="hr-address" className="block text-sm font-medium text-slate-700">
                    Street Address
                  </label>
                  <input
                    id="hr-address"
                    value={form.address}
                    onChange={(e) => set("address", e.target.value)}
                    className="input-field"
                    placeholder="Ward No. 6, Lakeside Road"
                    maxLength={400}
                    disabled={isLoading}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="hr-area" className="block text-sm font-medium text-slate-700">
                    Area / Locality
                  </label>
                  <input
                    id="hr-area"
                    value={form.area}
                    onChange={(e) => set("area", e.target.value)}
                    className="input-field"
                    placeholder="Lakeside"
                    maxLength={150}
                    disabled={isLoading}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="hr-district" className="block text-sm font-medium text-slate-700">
                    District
                  </label>
                  <input
                    id="hr-district"
                    value={form.district}
                    onChange={(e) => set("district", e.target.value)}
                    className="input-field"
                    placeholder="Kaski"
                    maxLength={100}
                    disabled={isLoading}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="hr-lat" className="block text-sm font-medium text-slate-700">
                    Latitude
                  </label>
                  <input
                    id="hr-lat"
                    type="number"
                    step="any"
                    value={form.latitude}
                    onChange={(e) => set("latitude", e.target.value)}
                    className="input-field"
                    placeholder="28.2096"
                    disabled={isLoading}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="hr-lng" className="block text-sm font-medium text-slate-700">
                    Longitude
                  </label>
                  <input
                    id="hr-lng"
                    type="number"
                    step="any"
                    value={form.longitude}
                    onChange={(e) => set("longitude", e.target.value)}
                    className="input-field"
                    placeholder="83.9856"
                    disabled={isLoading}
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor="hr-desc" className="block text-sm font-medium text-slate-700">
                    About your property
                  </label>
                  <textarea
                    id="hr-desc"
                    rows={4}
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                    className="input-field"
                    placeholder="A quiet lakeside retreat with mountain views, a heated pool and a garden cafe."
                    maxLength={6000}
                    disabled={isLoading}
                  />
                  <p className="text-xs text-slate-500">
                    Reviews need at least 50 characters, so a fuller description helps your listing
                    get approved.
                  </p>
                </div>
              </div>

              {catalog.length > 0 && (
                <div className="space-y-3 border-t border-slate-200 pt-5">
                  <div className="flex items-center gap-2">
                    <CheckCircleIcon className="h-5 w-5 text-slate-400" />
                    <span className="text-sm font-medium text-slate-700">
                      Amenities ({form.amenities.length} selected)
                    </span>
                  </div>

                  {Object.entries(grouped).map(([category, entries]) => (
                    <div key={category}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {category}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {entries.map((entry) => {
                          const selected = form.amenities.includes(entry.key);
                          return (
                            <button
                              key={entry.key}
                              type="button"
                              onClick={() => toggleAmenity(entry.key)}
                              disabled={isLoading}
                              aria-pressed={selected}
                              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                                selected
                                  ? "border-blue-500 bg-blue-50 text-blue-700"
                                  : "border-slate-300 text-slate-600 hover:border-slate-400"
                              }`}
                            >
                              {entry.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </fieldset>

            <button type="submit" className="btn-primary w-full" disabled={isLoading}>
              {isLoading ? "Creating your account..." : "Create hotel account"}
            </button>
          </form>

          <div className="mt-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <div className="flex items-start gap-2">
              <MapPinIcon className="mt-0.5 h-5 w-5 shrink-0" />
              <p>
                Your listing stays private until an admin activates your account and approves the
                property. You can keep editing everything in the meantime.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-1 text-center text-sm text-slate-600">
            <p>
              Already have an account?{" "}
              <Link to="/sign-in" className="font-medium text-blue-600 hover:text-blue-500">
                Sign in
              </Link>
            </p>
            <p>
              Looking to book a stay, or register as a user or vendor?{" "}
              <Link to="/signup" className="font-medium text-blue-600 hover:text-blue-500">
                Use the standard sign-up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HotelRegistration;
