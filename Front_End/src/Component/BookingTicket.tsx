import { useState } from "react";
import {
  FaBus,
  FaMapMarkerAlt,
  FaTicketAlt,
  FaTag,
  FaCalendarAlt,
  FaChair,
  FaRegClock,
  FaDownload,
  FaTrash,
  FaEnvelope,
} from "react-icons/fa";
import { ImSpinner8 } from "react-icons/im";
import { motion } from "framer-motion";
import html2pdf from "html2pdf.js";
import type { Booking } from "../api";
import type { TicketView } from "../utils/ticket";
import { buildTicketView } from "../utils/ticket";
import { formatTakeoffDate } from "../utils/datetime";

interface BookingTicketProps {
  booking: Booking;
  showCancel?: boolean;
  onCancel?: (id: string) => void;
  onEmail?: (id: string) => Promise<void> | void;
}

/** User-supplied names and points are interpolated into an HTML string below. */
const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );

const BookingTicket = ({
  booking,
  showCancel = false,
  onCancel,
  onEmail,
}: BookingTicketProps) => {
  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);

  /* One view model drives both the card and the PDF, and it mirrors the model
     the server uses for the emailed ticket — so all three always agree. */
  const view: TicketView = buildTicketView(booking);
  const isBus = view.isBus;
  const isCoD = view.paymentLabel === "Cash on Visit";

  const handleEmail = async () => {
    if (!onEmail) return;
    setEmailing(true);
    try {
      await onEmail(booking._id);
    } finally {
      setEmailing(false);
    }
  };

  /* Layout mirrors Back_End/utils/ticketService.js buildTicketHtml() field for
     field, so a downloaded ticket matches the one sent by email. */
  const buildTicketHtml = () => {
    const row = (label: string, value: unknown) => `
      <tr>
        <td style="padding: 9px 0; color: #6b7280; width: 42%; vertical-align: top;">${escapeHtml(label)}</td>
        <td style="padding: 9px 0; font-weight: 700; color: #0f172a;">${escapeHtml(value)}</td>
      </tr>`;

    const passengerRows = view.passengers.length
      ? view.passengers
          .map(
            (p) =>
              `<tr><td>${escapeHtml(p.seat || "-")}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(
                p.phone || "-"
              )}</td></tr>`
          )
          .join("")
      : "";

    return `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #ffffff;">
        <div style="background: #2563eb; color: #fff; padding: 18px 22px;">
          <h2 style="margin: 0; font-size: 20px;">BUS TICKET — TickXplore</h2>
        </div>
        <div style="padding: 22px;">
          <p style="margin: 0 0 6px; color: #6b7280; font-size: 12px; letter-spacing: .08em; text-transform: uppercase;">Booking Number</p>
          <p style="margin: 0 0 18px; font-size: 22px; font-weight: 700; color: #1d4ed8;">${escapeHtml(view.bookingNumber)}</p>

          <p style="margin: 0 0 14px;">Dear <strong>${escapeHtml(view.passengerName)}</strong>, here are your travel details:</p>

          <table style="width: 100%; border-collapse: collapse;">
            ${row("Passenger", view.passengerName)}
            ${row("Phone", view.passengerPhone)}
            ${row(view.transportLabel, view.isBus ? view.busName : view.seatLabel)}
            ${row("Seat", view.seatLabel)}
            ${row("Route", view.routeLabel)}
            ${row("Pickup Point", view.pickupPoint)}
            ${row("Dropping Point", view.dropPoint)}
            ${row("Takeoff Date", view.takeoffDateLabel)}
            ${row("Takeoff Time", view.takeoffTimeLabel)}
            ${row("Total Paid", `Rs. ${view.totalPrice}`)}
            ${row("Payment", view.paymentLabel)}
            ${row("Status", view.status)}
          </table>

          ${
            passengerRows
              ? `<p style="color: #6b7280; margin: 20px 0 6px; font-size: 13px; font-weight: 700;">Passengers</p>
                 <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                   <tr style="background: #f3f4f6; text-align: left;">
                     <th style="padding: 8px;">Seat</th><th style="padding: 8px;">Name</th><th style="padding: 8px;">Phone</th>
                   </tr>${passengerRows}
                 </table>`
              : ""
          }

          <p style="font-size: 11px; color: #9ca3af; margin: 22px 0 0;">
            This ticket is also attached as a PDF. Please bring this booking number to boarding.
            For any changes contact TickXplore support.
          </p>
        </div>
      </div>`;
  };

  const handleDownloadPDF = () => {
    setDownloading(true);

    const element = document.createElement("div");
    element.style.width = "600px";
    element.innerHTML = buildTicketHtml();

    document.body.appendChild(element);

    window.setTimeout(() => {
      const cleanup = () => {
        setDownloading(false);
        element.remove();
      };

      html2pdf()
        .set({
          margin: 10,
          /* Named after the real booking number, not a slice of the internal id. */
          filename: `ticket-${view.bookingNumber}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 2,
            logging: false,
            useCORS: true,
            scrollY: 0,
            windowWidth: element.scrollWidth,
            windowHeight: element.scrollHeight,
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(element)
        .save()
        .then(cleanup)
        .catch((err: unknown) => {
          console.error("PDF generation error:", err);
          cleanup();
        });
    }, 300);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="overflow-hidden rounded-2xl border border-slate-600 bg-slate-900 shadow-card transition hover:shadow-card-lg"
    >
      <div className="grid gap-6 p-6 md:grid-cols-3 md:p-8">
        <div className="space-y-4 border-slate-600 pr-6 md:border-r">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-slate-800 p-3">
              {isBus ? (
                <FaBus className="text-2xl text-blue-400" />
              ) : (
                <FaTicketAlt className="text-2xl text-amber-400" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">
                {isBus ? view.busName : "Reserved Vehicle"}
              </h2>
              <p className="text-sm text-slate-400">Booking No: {view.bookingNumber}</p>
              {view.passengerName !== "N/A" && (
                <p className="text-sm text-slate-400">Passenger: {view.passengerName}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <FaMapMarkerAlt className="text-slate-400" />
              <div>
                <p className="font-medium text-white">{view.pickupPoint}</p>
                <p className="text-sm text-slate-400">Departure</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <FaMapMarkerAlt className="text-slate-400" />
              <div>
                <p className="font-medium text-white">{view.dropPoint}</p>
                <p className="text-sm text-slate-400">Destination</p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 border-slate-400 pr-6 md:border-r">
          <div className="flex items-center gap-4">
            <FaChair className="text-xl text-emerald-400" />
            <div>
              <h3 className="font-semibold text-white">Seats</h3>
              <p className="text-slate-300">{view.seatLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <FaTag className="text-xl text-purple-400" />
            <div>
              <h3 className="font-semibold text-white">Total Paid</h3>
              <p className="text-xl font-bold text-white">NPR {view.totalPrice}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <FaRegClock className="text-xl text-sky-400" />
            <div>
              <h3 className="font-semibold text-white">Payment</h3>
              <p className="text-slate-300">{view.paymentLabel}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex flex-col gap-2">
            <span
              className={`w-fit rounded-full px-4 py-1 text-sm font-semibold ${
                isCoD
                  ? "bg-blue-900/30 text-blue-400"
                  : view.status === "Booked"
                  ? "bg-green-900/30 text-green-400"
                  : "bg-red-900/30 text-red-400"
              }`}
            >
              {view.status === "Booked"
                ? isCoD
                  ? "Booked (Cash on Visit)"
                  : view.status
                : isCoD
                ? "Pending (Cash on Visit)"
                : view.status}
            </span>
            {booking.createdAt && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <FaRegClock />
                {formatTakeoffDate(booking.createdAt, { withWeekday: true })}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={handleDownloadPDF}
              disabled={downloading}
              className="flex items-center justify-center gap-2 rounded-xl bg-blue-800 px-4 py-2 text-white transition-colors hover:bg-blue-900"
            >
              {downloading ? (
                <ImSpinner8 className="animate-spin" />
              ) : (
                <>
                  <FaDownload /> Download Ticket
                </>
              )}
            </button>
            {showCancel && onCancel && (
              <button
                onClick={() => onCancel(booking._id)}
                className="flex items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2 text-white transition-colors hover:bg-red-800"
              >
                <FaTrash /> Cancel Booking
              </button>
            )}
            {onEmail && (
              <button
                onClick={handleEmail}
                disabled={emailing}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-2 text-white transition-colors hover:bg-emerald-900"
              >
                {emailing ? (
                  <ImSpinner8 className="animate-spin" />
                ) : (
                  <>
                    <FaEnvelope /> Email Ticket
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {view.passengers.length > 0 && (
        <div className="border-t border-slate-600 p-4 md:p-6">
          <div className="flex items-center gap-2">
            <FaChair className="text-emerald-400" />
            <h3 className="font-semibold text-white">Passengers</h3>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {view.passengers.map((p, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg bg-slate-800 px-3 py-2 text-sm"
              >
                <span className="font-medium text-white">
                  {p.seat ? `${p.seat} · ` : ""}
                  {p.name}
                </span>
                {p.phone && <span className="text-slate-400">{p.phone}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-slate-600 bg-slate-800 p-4 text-sm text-slate-400">
        <FaCalendarAlt />
        <span>Departure: {view.takeoffDateTimeLabel}</span>
      </div>
    </motion.div>
  );
};

export default BookingTicket;
