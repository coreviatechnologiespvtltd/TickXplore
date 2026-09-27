import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FiEye, FiEyeOff, FiMail, FiLock } from "react-icons/fi";
import { FcGoogle } from "react-icons/fc";
import { jwtDecode } from "jwt-decode";
import { authApi } from "../api";
import { signInWithGoogle } from "../firebase";
import type { Role } from "../api/types";

type ForgotRole = "user" | "vendor" | "hotel" | "admin";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [otp, setOtp] = useState("");
  const [showResetOtpModal, setShowResetOtpModal] = useState(false);
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [selectedRole, setSelectedRole] = useState<ForgotRole>("user");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const navigate = useNavigate();

  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    try {
      setGoogleLoading(true);
      const idToken = await signInWithGoogle();
      const data = await authApi.googleSignIn(idToken);
      handleLoginSuccess(data as {
        token: string;
        user: { _id: string; role: Role; name?: string; email?: string; isActive?: boolean };
      });
    } catch (err) {
      console.error("Google sign-in error:", err);
      const msg = (err as { message?: string }).message;
      if (msg?.includes("not configured")) {
        toast.error(msg);
      } else {
        toast.error((err as { response?: { data?: { message?: string } } }).response?.data?.message || "Google sign-in failed. Please try again.");
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const togglePasswordVisibility = () => setShowPassword((v) => !v);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!email || !password) {
      toast.error("Please fill in all fields");
      setLoading(false);
      return;
    }

    try {
      const data = await authApi.signIn({ email, password });

      if (data?.token) {
        handleLoginSuccess(data);
      } else {
        toast.error("Unexpected response from server");
      }
    } catch (err) {
      console.error("Login error:", err);
      const axiosErr = err as {
        response?: { status?: number; data?: { message?: string } };
      };
      const errorMessage =
        axiosErr.response?.data?.message ||
        (axiosErr.response?.status === 401
          ? "Invalid email or password"
          : "Login failed. Please try again.");
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSuccess = (data: {
  token: string;
  user: { _id: string; role: Role; name?: string; email?: string; isActive?: boolean };
}) => {
  const { token, user } = data;

  if (!user?.role) {
    toast.error("Invalid user data received");
    return;
  }

  const decoded = jwtDecode<{ exp: number }>(token);
  const expiresAt = decoded.exp * 1000;

  localStorage.setItem("token", token);
  localStorage.setItem("tokenExpiresAt", String(expiresAt));
  localStorage.setItem("userRole", user.role);
  localStorage.setItem("userLoggedIn", "true");
  localStorage.setItem("userName", user.name || user.email || "User");

    const idKey =
      user.role === "admin" ? "adminId" : user.role === "vendor" ? "vendorId" : user.role === "hotel" ? "hotelId" : "userId";
    localStorage.setItem(idKey, user._id);

    window.dispatchEvent(new Event("storageUpdate"));

    window.setTimeout(() => {
      localStorage.clear();
      toast.error("Session expired. Please log in again.");
      navigate("/sign-in");
    }, expiresAt - Date.now());

    const redirectPath =
      user.role === "admin"
        ? "/Admin_Dashboard"
        : user.role === "vendor"
        ? "/VendorDashboard"
        :user.role ==="hotel"
        ? "/hoteldashboard"
        : "/";
    navigate(redirectPath);
    toast.success("Login successful!");
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!resetEmail) {
      toast.error("Please enter your email address");
      setLoading(false);
      return;
    }

    try {
      const data = await authApi.forgotPassword(selectedRole, resetEmail);

      setShowResetOtpModal(true);
      toast.success((data as { message?: string }).message || "OTP sent to your email!");
    } catch (err) {
      console.error("Forgot password error:", err);
      const axiosErr = err as { response?: { data?: { message?: string; error?: string } } };
      const errorMsg =
        axiosErr.response?.data?.message ||
        axiosErr.response?.data?.error ||
        "Failed to send OTP. Please try again.";
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleResetOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const data = await authApi.verifyResetOtp({ email: resetEmail, otp, role: selectedRole });

      if ((data as { success?: boolean }).success) {
        setShowResetOtpModal(false);
        setResetSent(true);
        toast.success("OTP verified successfully!");
      }
    } catch (err) {
      console.error("OTP Verification Failed:", err);
      const axiosErr = err as { response?: { data?: { message?: string } } };
      toast.error(axiosErr.response?.data?.message || "Invalid OTP. Please try again.");
      setOtp("");
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }

    try {
      const data = await authApi.resetPassword({ email: resetEmail, newPassword, role: selectedRole });

      if ((data as { success?: boolean }).success) {
        toast.success("Password reset successfully!");
        setForgotPasswordMode(false);
        setResetSent(false);
      }
    } catch (err) {
      console.error("Password reset error:", err);
      const axiosErr = err as { response?: { data?: { message?: string } } };
      toast.error(axiosErr.response?.data?.message || "Password reset failed. Please try again.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-slate-50 to-indigo-100 p-4">
      {showResetOtpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-card-lg">
            <div className="mb-6 text-center">
              <h3 className="text-2xl font-bold text-slate-900">Verify OTP</h3>
              <p className="mt-2 text-slate-500">Enter the OTP sent to {resetEmail}</p>
            </div>

            <form onSubmit={handleResetOtpSubmit} className="space-y-6">
              <div className="flex justify-center">
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="w-64 rounded-xl border-2 border-slate-200 p-4 text-center font-mono text-2xl tracking-widest outline-none focus:border-blue-500"
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>

              <button type="submit" className="btn-primary w-full">
                Verify OTP
              </button>
            </form>
          </div>
        </div>
      )}

      <div
        className={`w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-card-lg ${
          showResetOtpModal ? "blur-sm" : ""
        }`}
      >
        <div className="p-8">
          <div className="mb-8 text-center">
            <h1 className="mb-2 text-3xl font-bold text-slate-900">
              {forgotPasswordMode
                ? resetSent
                  ? "Reset Password"
                  : "Forgot Password"
                : "Welcome Back"}
            </h1>
            <p className="text-slate-500">
              {forgotPasswordMode
                ? resetSent
                  ? "Enter your new password"
                  : "Enter your email to reset password"
                : "Sign in to continue"}
            </p>
          </div>

          {forgotPasswordMode ? (
            resetSent ? (
              <form onSubmit={handlePasswordReset} className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input-field"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input-field"
                    required
                  />
                </div>

                <button type="submit" className="btn-primary w-full">
                  Reset Password
                </button>
              </form>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Account Type
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["user", "vendor", "admin"] as const).map((role) => (
                      <button
                        type="button"
                        key={role}
                        onClick={() => setSelectedRole(role)}
                        className={`rounded-xl py-2 px-3 text-sm font-medium transition-colors ${
                          selectedRole === role
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        {role.charAt(0).toUpperCase() + role.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Email address
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <FiMail className="text-slate-400" />
                    </div>
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="input-field !pl-10"
                      required
                    />
                  </div>
                </div>

                <button type="submit" className="btn-primary w-full">
                  Send OTP
                </button>

                <button
                  type="button"
                  onClick={() => setForgotPasswordMode(false)}
                  className="w-full py-2 text-slate-600 hover:text-slate-900"
                >
                  Back to Login
                </button>
              </form>
            )
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Email address
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <FiMail className="text-slate-400" />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-field !pl-10"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Password
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <FiLock className="text-slate-400" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field !pl-10 !pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={togglePasswordVisibility}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <FiEyeOff /> : <FiEye />}
                  </button>
                </div>
              </div>

              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? "Signing in..." : "Sign In"}
              </button>

              <button
                type="button"
                onClick={() => setForgotPasswordMode(true)}
                className="w-full text-blue-600 hover:underline"
              >
                Forgot Password?
              </button>

              <div className="flex items-center gap-3 py-2">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs uppercase tracking-wide text-slate-400">or</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={googleLoading}
                className="inline-flex w-full items-center justify-center gap-2.5 rounded-xl border-2 border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
              >
                <FcGoogle className="h-5 w-5 shrink-0" />
                {googleLoading ? "Signing in..." : "Continue with Google"}
              </button>

              <div className="border-t border-slate-100 pt-4 text-center">
                <NavLink to="/signup" className="text-blue-600 hover:underline">
                  Don&apos;t have an account? Sign Up
                </NavLink>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}