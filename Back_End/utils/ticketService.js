const PDFDocument = require("pdfkit");
const Booking = require("../models/Booking");
const User = require("../models/User");
const { sendEmail } = require("./sendEmail");
const {
  formatSeatLabel,
  isPopulated,
  buildTicketView,
  resolveItem,
} = require("./ticketView");

const text = (value) => (typeof value === "string" ? value.trim() : "");

/* ------------------------------------------------------------------ */
/* Email recipient                                                     */
/* ------------------------------------------------------------------ */

async function resolveRecipient(booking) {
  if (text(booking.customerEmail)) {
    return { email: booking.customerEmail, name: text(booking.customerName) || "Customer" };
  }

  const userId = booking.userId;
  if (isPopulated(userId) && userId.email) {
    return { email: userId.email, name: text(userId.name) || text(booking.customerName) || "Customer" };
  }

  try {
    const user = await User.findById(userId);
    if (user && user.email) {
      return { email: user.email, name: text(booking.customerName) || text(user.name) || "Customer" };
    }
  } catch {
    // A failed lookup must not stop the ticket from being attempted.
  }

  return { email: null, name: text(booking.customerName) || "Customer" };
}

/* ------------------------------------------------------------------ */
/* Email HTML                                                          */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function buildTicketHtml(view) {
  const passengersRows = view.passengers.length
    ? view.passengers
        .map(
          (p) =>
            `<tr><td>${escapeHtml(p.seat || "-")}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(
              p.phone || "-"
            )}</td></tr>`
        )
        .join("")
    : "";

  const row = (label, value, strong = true) => `
    <tr>
      <td style="padding: 9px 0; color: #6b7280; width: 42%; vertical-align: top;">${escapeHtml(label)}</td>
      <td style="padding: 9px 0;${strong ? " font-weight: 700;" : ""} color: #0f172a;">${escapeHtml(value)}</td>
    </tr>`;

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
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
          ${row("Bus", view.busName)}
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
          passengersRows
            ? `<p style="color: #6b7280; margin: 20px 0 6px; font-size: 13px; font-weight: 700;">Passengers</p>
               <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                 <tr style="background: #f3f4f6; text-align: left;">
                   <th style="padding: 8px;">Seat</th><th style="padding: 8px;">Name</th><th style="padding: 8px;">Phone</th>
                 </tr>${passengersRows}
               </table>`
            : ""
        }

        <p style="font-size: 11px; color: #9ca3af; margin: 22px 0 0;">
          This ticket is also attached as a PDF. Please bring this booking number to boarding.
          For any changes contact TickXplore support.
        </p>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Ticket PDF                                                          */
/* ------------------------------------------------------------------ */

const PAGE_WIDTH = 595.28;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function kv(doc, label, value, y) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#6b7280").text(label, MARGIN, y);
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#0f172a")
    .text(String(value ?? "-"), MARGIN + 170, y, { width: CONTENT_WIDTH - 170, align: "left" });
  return y + 20;
}

const ROUTE_ARROW = 10;
const ROUTE_ARROW_GAP = 19;

/**
 * The "Route" row. PDFKit's built-in fonts are WinAnsi only and cannot encode
 * U+2192, so the arrow is drawn as a vector path instead of being written as a
 * character. Both names stay on one line and the arrow is positioned from the
 * measured width of the pickup point.
 */
function routeRow(doc, view, y) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#6b7280").text("Route", MARGIN, y);

  const x = MARGIN + 170;
  const width = CONTENT_WIDTH - 170;
  const each = (width - ROUTE_ARROW_GAP - ROUTE_ARROW - 8) / 2;

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a");
  doc.text(view.pickupPoint, x, y, { width: each, lineBreak: false, ellipsis: true });

  const arrowStart = x + Math.min(doc.widthOfString(view.pickupPoint), each);
  const midY = y + 4;

  doc
    .moveTo(arrowStart + 3, midY)
    .lineTo(arrowStart + 3 + ROUTE_ARROW, midY)
    .lineWidth(1.1)
    .strokeColor("#0f172a")
    .stroke();
  doc
    .moveTo(arrowStart + 3 + ROUTE_ARROW, midY)
    .lineTo(arrowStart + ROUTE_ARROW, midY - 3)
    .lineTo(arrowStart + ROUTE_ARROW, midY + 3)
    .closePath()
    .fillColor("#0f172a")
    .fill();

  const dropX = arrowStart + 3 + ROUTE_ARROW + 6;
  doc.text(view.dropPoint, dropX, y, {
    width: Math.max(width - (dropX - x), 20),
    lineBreak: false,
    ellipsis: true,
  });

  return y + 20;
}

function separator(doc, y) {
  doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).strokeColor("#e2e8f0").lineWidth(1).stroke();
  return y + 14;
}

/** Renders the canonical ticket view. `view` comes from buildTicketView(). */
function renderTicketPdf(view) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 40, bottom: 40, left: MARGIN, right: MARGIN },
    });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    /* Header band */
    doc.rect(0, 0, PAGE_WIDTH, 92).fill("#2563eb");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(20).text("BUS TICKET", MARGIN, 28);
    doc.font("Helvetica").fontSize(10).text("TickXplore", MARGIN, 56);
    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .text(view.bookingNumber, MARGIN, 56, { width: CONTENT_WIDTH, align: "right" });

    /* Booking number block */
    let y = 118;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#6b7280");
    doc.text("BOOKING NUMBER", MARGIN, y);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#1d4ed8").text(view.bookingNumber, MARGIN, y + 13);
    y = separator(doc, y + 44);

    /* Passenger + transport */
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#6b7280");
    doc.text("PASSENGER", MARGIN, y);
    doc.text("PHONE", MARGIN + 260, y);
    y += 14;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a");
    doc.text(view.passengerName, MARGIN, y, { width: 240 });
    doc.text(view.passengerPhone, MARGIN + 260, y, { width: CONTENT_WIDTH - 260 });
    y = separator(doc, y + 24);

    /* Journey details */
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text("Journey Details", MARGIN, y);
    y += 22;
    y = kv(doc, "Bus", view.busName, y);
    y = kv(doc, "Seat", view.seatLabel, y);
    y = routeRow(doc, view, y);
    y = kv(doc, "Pickup Point", view.pickupPoint, y);
    y = kv(doc, "Dropping Point", view.dropPoint, y);
    y = kv(doc, "Takeoff Date", view.takeoffDateLabel, y);
    y = kv(doc, "Takeoff Time", view.takeoffTimeLabel, y);

    /* Passengers table */
    if (view.passengers.length > 0) {
      y += 14;
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text("Passengers", MARGIN, y);
      y += 22;
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#334155");
      doc.text("Seat", MARGIN, y);
      doc.text("Name", MARGIN + 80, y);
      doc.text("Phone", MARGIN + 320, y);
      y = separator(doc, y + 6);
      doc.font("Helvetica").fontSize(9).fillColor("#0f172a");
      view.passengers.forEach((p) => {
        y += 17;
        doc.text(p.seat || "-", MARGIN, y);
        doc.text(p.name, MARGIN + 80, y, { width: 230 });
        doc.text(p.phone || "-", MARGIN + 320, y, { width: CONTENT_WIDTH - 320 });
      });
    }

    /* Payment */
    y += 26;
    y = kv(doc, "Total Paid", `Rs. ${view.totalPrice}`, y);
    y = kv(doc, "Payment", view.paymentLabel, y);
    y = kv(doc, "Status", view.status, y);

    /* Footer */
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#94a3b8")
      .text(
        "Please bring this booking number to boarding. For changes contact TickXplore support.",
        MARGIN,
        780,
        { width: CONTENT_WIDTH, align: "center" }
      );

    doc.end();
  });
}

/* ------------------------------------------------------------------ */
/* Send engine                                                         */
/* ------------------------------------------------------------------ */

function ticketSubject(view) {
  return `Your Bus Ticket - ${view.bookingNumber}`;
}

function sanitizeFilename(value) {
  return String(value).replace(/[^A-Za-z0-9-_]/g, "-").replace(/--+/g, "-");
}

/**
 * Records delivery state. Never touches `bookingNumber` — the number is assigned
 * once at creation and must stay stable for the life of the booking.
 */
async function updateEmailState(booking, status, emailSentAt, emailError) {
  try {
    await Booking.findByIdAndUpdate(booking._id, {
      emailStatus: status,
      emailSentAt: emailSentAt ?? null,
      ...(emailError ? { emailError: String(emailError).slice(0, 500) } : {}),
    });
  } catch (err) {
    console.error("[ticketService] failed to persist email status:", err.message);
  }
}

/**
 * Build the PDF + HTML ticket and email them to the customer.
 * Never throws: a mail failure must not roll back a successful booking.
 */
async function sendTicketEmail(booking) {
  const view = await buildTicketView(booking);
  const recipient = await resolveRecipient(booking);

  if (!recipient.email) {
    await updateEmailState(booking, "None", null, "No customer email on file");
    return { status: "None", error: "No customer email on file", bookingNumber: view.bookingNumber };
  }

  let pdfBuffer;
  try {
    pdfBuffer = await renderTicketPdf(view);
  } catch (err) {
    await updateEmailState(booking, "Failed", null, err.message);
    return { status: "Failed", error: err.message, bookingNumber: view.bookingNumber };
  }

  const filename = `${sanitizeFilename(view.bookingNumber)}-ticket.pdf`;

  try {
    await sendEmail(recipient.email, ticketSubject(view), buildTicketHtml(view), [
      { filename, content: pdfBuffer, contentType: "application/pdf" },
    ]);
    await updateEmailState(booking, "Sent", new Date(), null);
    return { status: "Sent", bookingNumber: view.bookingNumber };
  } catch (err) {
    await updateEmailState(booking, "Failed", null, err.message);
    return { status: "Failed", error: err.message, bookingNumber: view.bookingNumber };
  }
}

module.exports = {
  formatSeatLabel,
  buildTicketView,
  resolveItem,
  renderTicketPdf,
  buildTicketHtml,
  sendTicketEmail,
};
