/**
 * One-off, idempotent migration: give every existing booking a proper
 * "<YEAR><4-digit sequence>" booking number.
 *
 * Existing rows hold a derived label such as "Mountain Express-2B", or nothing
 * at all, and some are duplicated. This walks bookings oldest-first so the year
 * prefix comes from each booking's own creation date and the sequence ascends
 * in the order customers actually booked.
 *
 * Safe to re-run: a row that already carries an issued number is skipped, and
 * `bookingNumber` is never overwritten with a different value once assigned.
 * "Already issued" spans both the current 4-digit width and the legacy 5-digit
 * one, so numbers handed out before the width changed are never rewritten.
 *
 *   cd Back_End
 *   node seed/backfillBookingNumbers.js            # dry run, prints a plan
 *   node seed/backfillBookingNumbers.js --apply    # writes
 */

require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const { backfillBookingNumber, ISSUED_NUMBER_RE } = require("../utils/bookingNumber");
const { currentYear } = require("../utils/datetime");

const APPLY = process.argv.includes("--apply");
const BATCH = 200;

/** A booking needs a number only if it has no issued one in any width. */
const needsBackfill = {
  $or: [
    { bookingNumber: { $exists: false } },
    { bookingNumber: "" },
    { bookingNumber: { $not: ISSUED_NUMBER_RE } },
  ],
};

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set.");

  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log(`Connected. ${APPLY ? "APPLYING changes." : "Dry run — no writes."}\n`);

  /* 1. Report what is already there. */
  const [total, alreadyValid, blank] = await Promise.all([
    Booking.countDocuments(),
    Booking.countDocuments({ bookingNumber: { $regex: ISSUED_NUMBER_RE } }),
    Booking.countDocuments({ $or: [{ bookingNumber: { $exists: false } }, { bookingNumber: "" }] }),
  ]);
  console.log(`Bookings total            : ${total}`);
  console.log(`Already issued a number   : ${alreadyValid}`);
  console.log(`Missing a number          : ${blank}`);
  console.log(`Legacy "<Item>-<seats>"   : ${total - alreadyValid - blank}\n`);

  /* 2. Flag duplicate legacy numbers so the data mess stays visible. */
  const duplicates = await Booking.aggregate([
    { $match: { bookingNumber: { $type: "string", $ne: "" } } },
    { $group: { _id: "$bookingNumber", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);
  if (duplicates.length) {
    console.log(`Duplicate legacy numbers  : ${duplicates.length} (will be replaced)`);
    duplicates
      .slice(0, 5)
      .forEach((d) => console.log(`    ${d.count}x  ${d._id}`));
    if (duplicates.length > 5) console.log(`    ...and ${duplicates.length - 5} more`);
    console.log("");
  }

  /* 3. Walk oldest-first, backfilling anything not already issued. */
  const plan = [];
  let cursor = Booking.find(needsBackfill, { bookingNumber: 1, createdAt: 1 })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  let scanned = 0;
  for await (const doc of cursor) {
    scanned += 1;
    const year = currentYear(doc.createdAt || new Date());
    plan.push({ _id: doc._id, from: doc.bookingNumber || null, year });
  }

  if (!plan.length) {
    console.log("Nothing to backfill. Every booking already carries an issued number.");
    await mongoose.disconnect();
    return;
  }

  /* 4. Apply, oldest-first, so each year's sequence ascends chronologically. */
  let written = 0;
  const perYear = new Map();
  const remapped = [];
  for (let i = 0; i < plan.length; i += BATCH) {
    const batch = plan.slice(i, i + BATCH);
    for (const entry of batch) {
      const booking = await Booking.findById(entry._id);
      if (!booking) continue;
      const result = await backfillBookingNumber(booking, booking.createdAt || new Date());
      if (!result.changed) continue;
      if (APPLY) await booking.save();
      written += 1;
      const y = result.bookingNumber.slice(0, 4);
      perYear.set(y, (perYear.get(y) || 0) + 1);
      if (result.legacy) remapped.push({ id: String(booking._id), from: result.legacy, to: result.bookingNumber });
    }
    process.stdout.write(`  processed ${Math.min(i + BATCH, plan.length)}/${plan.length}\r`);
  }

  if (remapped.length) {
    console.log("\nLegacy values replaced (kept here for the record):");
    for (const r of remapped) console.log(`    ${r.id}  ${r.from}  ->  ${r.to}`);
  }

  console.log(`\nScanned                  : ${scanned}`);
  console.log(`${APPLY ? "Assigned" : "Would assign"}              : ${written}`);
  if (perYear.size) {
    console.log("Per year:");
    for (const [year, count] of [...perYear].sort()) console.log(`    ${year}???? : ${count}`);
  }

  if (!APPLY) {
    console.log("\nThis was a dry run. Re-run with --apply to write the changes.");
  } else {
    const remaining = await Booking.countDocuments(needsBackfill);
    console.log(`\nBookings still needing one : ${remaining}`);
    if (remaining > 0) {
      console.error("Migration incomplete — re-run this script.");
      process.exitCode = 1;
    } else {
      console.log("Migration complete. Every booking now carries an issued booking number.");
    }
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("\nBackfill failed:", err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
