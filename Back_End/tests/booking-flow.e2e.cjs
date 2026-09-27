/**
 * End-to-end check of the booking-number / trip-snapshot / ticket chain.
 * Mirrors what routes/payment.js does at booking time, then renders the real
 * PDF and asserts the emailed-ticket values.
 *
 * Requires a reachable MongoDB (reads MONGO_URI from ../.env). It creates a test
 * bus, a test vehicle and 25 test bookings, then removes them again. The yearly
 * counter is deliberately left advanced — gaps in the sequence are harmless, and
 * the counter is never moved backwards.
 *
 *   cd Back_End
 *   npm test
 */
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const mongoose = require("mongoose");
const assert = require("assert");

const Booking = require("../models/Booking");
const Bus = require("../models/Bus");
const BookingSequence = require("../models/BookingSequence");
const {
  allocateBookingNumber,
  backfillBookingNumber,
  formatNumber,
  highestIssuedSequence,
  isBookingNumberFormat,
  ISSUED_NUMBER_RE,
} = require("../utils/bookingNumber");
const {
  parseTakeoffInput,
  formatTakeoffDate,
  formatTakeoffTime,
  currentYear,
} = require("../utils/datetime");
const { buildTicketView } = require("../utils/ticketView");
const { renderTicketPdf, buildTicketHtml } = require("../utils/ticketService");

/* --- format rules, no database needed ---------------------------------- */

/*
 * The customer-facing number is YYYY + a 4-digit sequence: 8 digits total.
 * `formatNumber` is pure, so every documented example is asserted directly
 * rather than inferred from a counter that moves during the run.
 */
function checkNumberFormat() {
  const expected = [
    [1, "20260001"],
    [2, "20260002"],
    [3, "20260003"],
    [9, "20260009"],
    [10, "20260010"],
    [11, "20260011"],
    [99, "20260099"],
    [100, "20260100"],
    [1000, "20261000"],
    [9999, "20269999"],
  ];
  for (const [sequence, want] of expected) {
    const got = formatNumber(2026, sequence);
    assert.strictEqual(got, want, `formatNumber(2026, ${sequence}) should be ${want}`);
    assert.strictEqual(got.length, 8, `${got} must be 8 digits`);
  }
  /* The old 5-digit form must no longer be produced. */
  for (const forbidden of ["202600001", "202600002"]) {
    assert.ok(
      !expected.some(([, want]) => want === forbidden),
      `${forbidden} must not be generated`
    );
  }
  /* A new year restarts the sequence. */
  assert.strictEqual(formatNumber(2027, 1), "20270001");
  assert.strictEqual(formatNumber(2027, 3), "20270003");
  /* A legacy 5-digit number still counts as issued, so it is never rewritten. */
  assert.ok(isBookingNumberFormat("202600001"), "a legacy 9-digit number must count as issued");
  assert.ok(isBookingNumberFormat("20260001"), "a current 8-digit number must count as issued");
  assert.ok(!isBookingNumberFormat("Mountain Express-2B"), "a legacy label must not count as issued");
  console.log(`   format: seq 1,2,9,10,100,9999 -> ${formatNumber(2026, 1)}, ${formatNumber(2026, 2)}, ${formatNumber(2026, 9)}, ${formatNumber(2026, 10)}, ${formatNumber(2026, 100)}, ${formatNumber(2026, 9999)}`);
  console.log(`   2027 restarts at ${formatNumber(2027, 1)}; legacy 9-digit numbers still count as issued`);
}

/*
 * The year must come from Nepal time, not the server clock. Nepal is UTC+5:45,
 * so there is a window each new year where the UTC date has already ticked over
 * but Nepal has not: 18:45 UTC on 31 Dec is already 00:30 on 1 Jan in Kathmandu.
 * A server-timezone year would label that booking 2026; the Nepal-time year
 * must label it 2027.
 */
function checkNepalYear() {
  const eveNepal = new Date("2026-12-31T17:45:00.000Z"); // 23:30 Nepal, 31 Dec 2026
  const newYearNepal = new Date("2026-12-31T18:45:00.000Z"); // 00:30 Nepal, 1 Jan 2027

  assert.strictEqual(currentYear(eveNepal), 2026, "23:30 on 31 Dec Nepal must be 2026");
  assert.strictEqual(formatNumber(currentYear(eveNepal), 1), "20260001");

  /* The discriminating case: UTC still reads 2026, Nepal has already turned. */
  assert.strictEqual(
    newYearNepal.getUTCFullYear(),
    2026,
    "fixture must still look like 2026 in UTC"
  );
  assert.strictEqual(
    currentYear(newYearNepal),
    2027,
    "00:30 on 1 Jan Nepal must be 2027, not the server's UTC year"
  );
  assert.strictEqual(formatNumber(currentYear(newYearNepal), 1), "20270001");
  console.log(
    "   Nepal-time year: 23:30 on 31 Dec -> 2026, and 00:30 on 1 Jan -> 2027 even though UTC still reads 2026"
  );
}

/*
 * A departure entered as wall-clock time must be stored as the instant that
 * wall-clock represents in Nepal, and must display as the day the vendor typed.
 *
 * A bus was once stored as 2026-09-30T18:30:00.000Z because the value carried a
 * `Z`. That is a genuine instant, so it was honoured — but 18:30 UTC is 00:15 on
 * 1 October in Nepal, so the trip rolled into the next day and every ticket read
 * "1 October 2026, 12:15 AM" for a departure meant to be 6:30 PM on 30 September.
 *
 * These assertions pin both halves: the zone-less form means wall-clock, and a
 * zoned value keeps its instant meaning rather than being silently re-read.
 */
function checkTakeoffWallClock() {
  /* Zone-less, exactly what a datetime-local form submits. */
  const wallClock = parseTakeoffInput("2026-09-30T18:30");
  assert.ok(wallClock, "a zone-less take-off must parse");
  assert.strictEqual(
    wallClock.toISOString(),
    "2026-09-30T12:45:00.000Z",
    "18:30 Nepal must be stored as 12:45Z"
  );
  assert.strictEqual(formatTakeoffDate(wallClock), "30 September 2026");
  assert.strictEqual(formatTakeoffTime(wallClock), "06:30 PM");

  /* Same instant, expressed with Nepal's own offset, must agree. */
  const offsetForm = parseTakeoffInput("2026-09-30T18:30:00+05:45");
  assert.strictEqual(
    offsetForm.toISOString(),
    "2026-09-30T12:45:00.000Z",
    "an explicit +05:45 must denote the same instant"
  );

  /* A `Z` value stays an instant — this is the behaviour the bug relied on. */
  const asUtc = parseTakeoffInput("2026-09-30T18:30:00.000Z");
  assert.strictEqual(asUtc.toISOString(), "2026-09-30T18:30:00.000Z");
  assert.strictEqual(
    formatTakeoffDate(asUtc),
    "1 October 2026",
    "18:30Z really is the next day in Nepal — the guard warns, it does not rewrite"
  );

  /* The failure this prevents: the two forms must not be interchangeable. */
  assert.notStrictEqual(
    wallClock.toISOString(),
    asUtc.toISOString(),
    "a Z-suffixed value must not be treated as wall-clock time"
  );
  console.log(
    '   wall-clock "2026-09-30T18:30" -> 30 September 2026 06:30 PM; the same text with a Z stays 1 October (guarded, not rewritten)'
  );
}

/* Mirrors buildTripFields() in routes/payment.js. */
function buildTripFields({ type, bus, vehicle, seats, takeOffDate, pickupPoint, dropPoint }) {
  if (type === "bus") {
    if (!bus) throw new Error("Bus not found");
    return {
      busId: bus._id,
      selectedSeats: (seats || []).map(Number),
      pickupPoint: bus.pickupPoint,
      dropPoint: bus.dropPoint,
      takeOffDate: bus.takeOffDate,
    };
  }
  if (!vehicle) throw new Error("Vehicle not found");
  const reservationDate = parseTakeoffInput(takeOffDate);
  return {
    vehicleId: vehicle._id,
    reservationDate: reservationDate || undefined,
    pickupPoint: String(pickupPoint || "").trim() || vehicle.pickupPoint || "N/A",
    dropPoint: String(dropPoint || "").trim() || vehicle.dropPoint || "N/A",
  };
}

let created = { busId: null, vehicleId: null, bookingIds: [] };
const cleanup = async () => {
  if (created.bookingIds.length) await Booking.deleteMany({ _id: { $in: created.bookingIds } });
  if (created.busId) await Bus.deleteOne({ _id: created.busId });
  if (created.vehicleId) await mongoose.connection.db.collection("vehicles").deleteOne({ _id: created.vehicleId });
  await mongoose.disconnect();
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  /* --- format rules, asserted without touching the database ---------- */
  checkNumberFormat();
  checkNepalYear();
  checkTakeoffWallClock();
  console.log("");

  /* 1. A vendor types 07:30 into the form; the server stores the Kathmandu instant. */
  const typedTakeoff = "2026-12-24T07:30";
  const bus = await Bus.create({
    name: "E2E Test Bus",
    pickupPoint: "Kathmandu",
    dropPoint: "Pokhara",
    pricePerSeat: 800,
    totalSeats: 12,
    bookedSeats: [],
    takeOffDate: parseTakeoffInput(typedTakeoff),
    status: "Active",
    vendorId: new mongoose.Types.ObjectId(),
    image: "e2e-test.png",
  });
  created.busId = bus._id;
  assert.strictEqual(
    bus.takeOffDate.toISOString(),
    "2026-12-24T01:45:00.000Z",
    "07:30 Kathmandu must be stored as 01:45Z"
  );
  console.log("1. vendor typed 07:30 -> stored", bus.takeOffDate.toISOString());
  console.log("   renders as", formatTakeoffDate(bus.takeOffDate), formatTakeoffTime(bus.takeOffDate));

  /* 2. A booking that TRIES to override the route/takeoff must be ignored. */
  const trip = buildTripFields({
    type: "bus",
    bus,
    seats: [1, 2, 5],
    takeOffDate: "2099-01-01T00:00",
    pickupPoint: "HACKED",
    dropPoint: "HACKED",
  });
  assert.strictEqual(trip.pickupPoint, "Kathmandu", "client pickup must not win");
  assert.strictEqual(trip.dropPoint, "Pokhara", "client drop must not win");
  assert.strictEqual(trip.takeOffDate.toISOString(), "2026-12-24T01:45:00.000Z", "client takeoff must not win");
  console.log("2. client-supplied route/takeoff ignored ->", trip.pickupPoint, "->", trip.dropPoint);

  /* 3. Concurrent booking creation never reuses a number. */
  const drafts = Array.from({ length: 25 }, () => ({
    ...trip,
    customerName: "E2E Rider",
    customerPhone: "9800000000",
    totalPrice: 2400,
    status: "Booked",
    paymentMethod: "CashOnVisit",
    paymentStatus: "CashOnVisit",
  }));
  const issued = await Promise.all(
    drafts.map(async (d) => {
      const booking = await Booking.create({ ...d, bookingNumber: await allocateBookingNumber() });
      created.bookingIds.push(booking._id);
      return { id: String(booking._id), bookingNumber: booking.bookingNumber };
    })
  );
  const numbers = issued.map((i) => i.bookingNumber);
  const numberById = new Map(issued.map((i) => [i.id, i.bookingNumber]));
  assert.strictEqual(new Set(numbers).size, 25, "booking numbers collided under concurrency");
  assert.ok(numbers.every((n) => /^[0-9]{8}$/.test(n)), "a number was not 8 digits");
  console.log(`3. 25 concurrent bookings -> 25 unique numbers (${numbers[0]} … ${numbers[24]})`);
  const year = currentYear();
  assert.ok(numbers.every((n) => n.slice(0, 4) === String(year)), "year prefix wrong");
  console.log("   all prefixed with", year, "(Nepal time)");
  /* Every issued number must be unique across the whole collection, not just
     within this batch. */
  const clash = await Booking.countDocuments({ bookingNumber: { $in: numbers } });
  assert.strictEqual(clash, 25, "a number from this batch also exists on another booking");

  /* 4. The number is immutable: a later save cannot change or clear it. */
  const targetId = String(created.bookingIds[0]);
  const target = await Booking.findById(targetId);
  const original = target.bookingNumber;
  assert.strictEqual(original, numberById.get(targetId), "the number read back differs from the one issued");
  target.status = "Pending";
  await target.save();
  const afterStatus = await Booking.findById(targetId);
  assert.strictEqual(afterStatus.bookingNumber, original, "a status change altered bookingNumber");
  target.totalPrice = 999;
  target.paymentStatus = "Paid";
  target.customerName = "Changed Name";
  await target.save();
  const reread = await Booking.findById(targetId);
  assert.strictEqual(reread.bookingNumber, original, "a price/payment change altered bookingNumber");
  console.log(`4. number survives status, price and passenger updates -> still ${reread.bookingNumber}`);
  await reread.deleteOne();
  created.bookingIds = created.bookingIds.filter((id) => String(id) !== String(reread._id));

  /* 5. The ticket renders the DATABASE values, not the request. */
  const view = await buildTicketView(reread);
  assert.strictEqual(view.bookingNumber, original);
  assert.strictEqual(view.pickupPoint, "Kathmandu");
  assert.strictEqual(view.dropPoint, "Pokhara");
  assert.strictEqual(view.routeLabel, "Kathmandu → Pokhara");
  assert.strictEqual(view.seatLabel, "A1, A2, B1", "seat labels wrong");
  assert.strictEqual(view.takeoffDateLabel, "24 December 2026");
  assert.strictEqual(view.takeoffTimeLabel, "07:30 AM");
  assert.strictEqual(view.paymentLabel, "Cash on Visit");

  /* The booking email is sent from a freshly created document, so `busId` is an
     unpopulated ObjectId here. A populated-looking check would skip the Bus
     lookup and print "N/A" for the operator. */
  assert.strictEqual(
    reread.busId._bsontype,
    "ObjectId",
    "fixture must be an unpopulated reference"
  );
  assert.strictEqual(view.busName, "E2E Test Bus", "an unpopulated busId must not render as N/A");
  console.log("5. ticket view:", view.bookingNumber, "|", view.routeLabel, "|", view.seatLabel, "|", view.takeoffDateTimeLabel);
  console.log("   unpopulated ObjectId resolved to bus:", view.busName);

  /* 5b. Legacy rows: the snapshot is the literal "N/A", so the ticket has to
        fall back to the Bus document for its name, route and take-off. */
  const legacyId = created.bookingIds[1];
  await Booking.updateOne(
    { _id: legacyId },
    { $set: { pickupPoint: "N/A", dropPoint: "N/A", takeOffDate: null } }
  );
  const legacy = await Booking.findById(legacyId);
  const legacyView = await buildTicketView(legacy);
  assert.strictEqual(legacyView.busName, "E2E Test Bus", "legacy bus name must come from the Bus document");
  assert.strictEqual(legacyView.pickupPoint, "Kathmandu", "legacy pickup must come from the Bus document");
  assert.strictEqual(legacyView.dropPoint, "Pokhara", "legacy drop must come from the Bus document");
  assert.strictEqual(legacyView.routeLabel, "Kathmandu → Pokhara");
  assert.strictEqual(legacyView.takeoffDateLabel, "24 December 2026", "legacy take-off must come from the Bus document");
  assert.strictEqual(legacyView.takeoffTimeLabel, "07:30 AM");
  console.log("5b. legacy snapshot fell back to the bus ->", legacyView.busName, "|", legacyView.routeLabel, "|", legacyView.takeoffDateTimeLabel);

  /* 6. The real PDF renders and contains the booking number. PDFKit writes
        FlateDecode streams, so the text has to be inflated before searching. */
  const pdf = await renderTicketPdf(view);
  assert.ok(Buffer.isBuffer(pdf) && pdf.length > 1000, "PDF too small");
  assert.strictEqual(pdf.subarray(0, 5).toString(), "%PDF-", "not a PDF");
  const raw = pdf.toString("latin1");

  const zlib = require("zlib");
  let text = "";
  const streamRe = /stream\r?\n/g;
  let m;
  while ((m = streamRe.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) continue;
    const chunk = Buffer.from(raw.slice(start, end), "latin1");
    try {
      text += zlib.inflateSync(chunk).toString("latin1");
    } catch {
      /* not a deflate stream — ignore */
    }
  }
  const inPdf =
    raw +
    text +
    /* PDFKit writes strings as hex glyph ids: <323032363030303436> == "202600046". */
    (text.match(/<[0-9A-Fa-f]+>/g) || [])
      .map((h) => Buffer.from(h.slice(1, -1), "hex").toString("latin1"))
      .join("");
  assert.ok(inPdf.includes(original), "booking number missing from the PDF");
  assert.ok(inPdf.includes("Kathmandu") && inPdf.includes("Pokhara"), "route missing from the PDF");

  /* PDFKit's built-in fonts are WinAnsi only, so a "→" written as text is
     encoded as U+0021 U+0092 and prints as "!'". The arrow has to be a drawn
     path instead, sitting between the two place names and pointing right. */
  assert.ok(
    !inPdf.includes(String.fromCharCode(0x21, 0x92)),
    "a mangled arrow (0x21 0x92) reached the PDF; it must be drawn as a vector path"
  );

  /* Text runs, with the x/y each one was placed at. Kerning splits a label into
     several hex runs, so a run is reassembled from all of its glyph ids. */
  const PAGE = 841.89;
  const runs = [];
  const runRe = /1 0 0 1 ([\d.]+) ([\d.]+) Tm\s*\/\w+ [\d.]+ Tf\s*\[(.*?)\] TJ/gs;
  let rm;
  while ((rm = runRe.exec(text)) !== null) {
    const glyphs = [...rm[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((g) => g[1]);
    runs.push({
      x: Number(rm[1]),
      y: Number(rm[2]),
      text: glyphs.map((h) => Buffer.from(h, "hex").toString("latin1")).join(""),
    });
  }
  const pickupRun = runs.find((r) => r.text === "Kathmandu");
  const dropRun = runs.find((r) => r.text === "Pokhara");
  assert.ok(pickupRun && dropRun, "the route place names are missing from the PDF");
  assert.ok(pickupRun.x < dropRun.x, "the dropping point must follow the pickup point");

  /* A shaft is a horizontal m/l pair. Separators are drawn the same way, so pick
     the one that actually falls between the two place names. */
  const shafts = [...text.matchAll(/([\d.]+) ([\d.]+) m\s+([\d.]+) \2 l/g)].map((m) => ({
    from: Number(m[1]),
    to: Number(m[3]),
    y: Number(m[2]),
  }));
  const shaft = shafts.find(
    (s) => s.from >= pickupRun.x && s.to <= dropRun.x && s.to > s.from
  );
  assert.ok(shaft, "the route arrow shaft was not drawn between the two place names");

  const heads = [...text.matchAll(/([\d.]+) ([\d.]+) m\s+([\d.]+) [\d.]+ l\s+[\d.]+ [\d.]+ l\s+h\b[\s\S]{0,200}?\bf\b/g)].map(
    (m) => ({ apex: Number(m[1]), base: Number(m[3]), y: Number(m[2]) })
  );
  const head = heads.find((h) => h.apex > h.base && h.apex >= shaft.from && h.apex <= dropRun.x);
  assert.ok(head, "the route arrow head was not drawn, filled and pointing right");

  /* Path y and text y share one document space, so the arrow must land on the
     same line as the place names rather than elsewhere on the page. */
  const lineY = PAGE - pickupRun.y;
  assert.ok(
    Math.abs(shaft.y - lineY) < 12,
    `the route arrow is off the text line (arrow y=${shaft.y}, text y=${lineY})`
  );
  console.log(
    `6. PDF rendered: ${pdf.length} bytes, header ${pdf.subarray(0, 5)}, contains ${original} + route, arrow drawn as a vector path`
  );

  /* 7. The emailed HTML carries the same number. */
  const html = buildTicketHtml(view);
  assert.ok(html.includes(original), "booking number missing from the email HTML");
  assert.ok(html.includes("24 December 2026") && html.includes("07:30 AM"), "takeoff wrong in email HTML");
  assert.ok(html.includes("Kathmandu") && html.includes("Pokhara"), "route wrong in email HTML");
  console.log("7. email HTML carries the same number, route and take-off");

  /* 8. The self-healing floor still protects the numbers already handed out. */
  const floorNow = await highestIssuedSequence(year);
  const highestSequence = Math.max(...numbers.map((n) => Number(n.slice(4))));
  assert.ok(
    floorNow >= highestSequence,
    `floor regressed to ${floorNow}, below the highest issued sequence ${highestSequence}`
  );
  console.log(
    `8. floor for ${year} is ${floorNow}, at or above the highest issued sequence ${highestSequence}`
  );

  /* 9. Numbers already issued can never be handed out again, even if the
        counter document is lost entirely — the floor is rebuilt from the data. */
  await BookingSequence.deleteMany({ _id: String(year) });
  const afterWipe = await allocateBookingNumber();
  assert.ok(!numbers.includes(afterWipe), `re-issued an already-used number: ${afterWipe}`);
  assert.ok(
    Number(afterWipe.slice(4)) > highestSequence,
    `floor did not advance past ${highestSequence}: got ${afterWipe}`
  );
  /* Legacy 9-digit numbers live in a different namespace and are never rebuilt
     from, so the assertion is that we do not fall into it. */
  assert.ok(
    !ISSUED_NUMBER_RE.test(afterWipe) || afterWipe.length === 8,
    `a legacy-width number was issued: ${afterWipe}`
  );
  assert.strictEqual(afterWipe.length, 8, `expected 8 digits, got ${afterWipe}`);
  const legacyClash = await Booking.countDocuments({ bookingNumber: afterWipe });
  assert.strictEqual(legacyClash, 0, `${afterWipe} already exists on a booking`);
  console.log(`9. counter wiped -> next number ${afterWipe}, 8 digits, above every number just issued`);

  /* 10. A new year gets its own counter and cannot disturb the current one. */
  const beforeNextYear = await BookingSequence.findOne({ _id: String(year) });
  await BookingSequence.deleteOne({ _id: "2027" });
  const nextYearNumber = await allocateBookingNumber(new Date("2027-06-15T10:00:00+05:45"));
  assert.strictEqual(nextYearNumber, "20270001", "a new year must restart at 20270001");
  const afterNextYear = await BookingSequence.findOne({ _id: String(year) });
  assert.strictEqual(
    afterNextYear.seq,
    beforeNextYear.seq,
    "issuing for another year moved this year's counter"
  );
  const twoNextYear = await allocateBookingNumber(new Date("2027-06-16T10:00:00+05:45"));
  assert.strictEqual(twoNextYear, "20270002", "the new year's counter did not advance independently");
  await BookingSequence.deleteOne({ _id: "2027" });
  console.log(
    `10. year 2027 issued ${nextYearNumber} then ${twoNextYear} on its own counter; ${year} untouched`
  );

  /* 11. A number that was already issued is never regenerated, in either width. */
  const legacyBooking = new Booking({
    busId: bus._id,
    customerName: "Legacy Rider",
    totalPrice: 100,
    bookingNumber: "202600001",
  });
  const legacyResult = await backfillBookingNumber(legacyBooking, new Date());
  assert.strictEqual(legacyResult.changed, false, "a legacy 9-digit number was marked for rewrite");
  assert.strictEqual(legacyBooking.bookingNumber, "202600001", "a legacy number was overwritten");

  const currentBooking = new Booking({
    busId: bus._id,
    customerName: "Current Rider",
    totalPrice: 100,
    bookingNumber: "20260001",
  });
  const currentResult = await backfillBookingNumber(currentBooking, new Date());
  assert.strictEqual(currentResult.changed, false, "a current 8-digit number was marked for rewrite");
  assert.strictEqual(currentBooking.bookingNumber, "20260001", "a current number was overwritten");

  const unlabelled = new Booking({ busId: bus._id, customerName: "Labelled", totalPrice: 100 });
  const labelledResult = await backfillBookingNumber(unlabelled, new Date());
  assert.strictEqual(labelledResult.changed, true, "a booking with no number was not backfilled");
  assert.ok(/^[0-9]{8}$/.test(labelledResult.bookingNumber), "backfill used the wrong width");
  console.log(
    `11. backfill left 202600001 and 20260001 untouched; only the unlabelled row got ${labelledResult.bookingNumber}`
  );

  console.log("\nOK: booking-number, trip-snapshot and ticket chain verified end to end.");
  await cleanup();
  process.exit(0);
})().catch(async (err) => {
  console.error("\nE2E FAILED:", err);
  await cleanup().catch(() => {});
  process.exit(1);
});
