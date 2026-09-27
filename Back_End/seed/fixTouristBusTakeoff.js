/**
 * One-off corrective migration: fix the TouristBus departure instant.
 *
 * The bus stored `2026-09-30T18:30:00.000Z` — a UTC instant. Read as Nepal time
 * (UTC+05:45) that is 00:15 on 1 October, so the trip rolled into the next day
 * and every ticket showed "1 October 2026, 12:15 AM".
 *
 * 18:30 was meant as a *wall-clock* departure on 30 September, i.e. 18:30 Nepal
 * time, which is `2026-09-30T12:45:00.000Z`. The bus document is the trip, and
 * each booking holds its own snapshot of it, so both are corrected here.
 *
 * The corrected instant is derived with the app's own `parseTakeoffInput` from
 * the intended wall-clock rather than being written as a literal, so the intent
 * stays readable and cannot drift from the app's timezone rules.
 *
 * Safe to re-run: documents already holding the corrected value are skipped, and
 * the script refuses to write unless the document set matches exactly what was
 * audited.
 *
 *   cd Back_End
 *   node seed/fixTouristBusTakeoff.js           # dry run, prints a plan
 *   node seed/fixTouristBusTakeoff.js --apply   # writes
 */

require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Bus = require("../models/Bus");
const { parseTakeoffInput, formatTakeoffDate, formatTakeoffTime } = require("../utils/datetime");

const APPLY = process.argv.includes("--apply");

/** The trip that was entered with a UTC string instead of a wall-clock time. */
const BUS_ID = "6ab14c0a3c14874ce9c13f14";

/** The departure as a vendor meant it: 6:30 PM on 30 September, Nepal time. */
const INTENDED_WALL_CLOCK = "2026-09-30T18:30";

const FROM = new Date("2026-09-30T18:30:00.000Z");
const TO = parseTakeoffInput(INTENDED_WALL_CLOCK);

/** Exactly what the audit found; anything else means stop and re-audit. */
const EXPECTED_BOOKINGS = 20;

const show = (d) => `${d.toISOString()}  ->  ${formatTakeoffDate(d)} ${formatTakeoffTime(d)}`;

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set.");

  if (!TO || Number.isNaN(TO.getTime())) {
    throw new Error(`Could not parse the intended wall-clock "${INTENDED_WALL_CLOCK}".`);
  }

  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log(`Connected. ${APPLY ? "APPLYING changes." : "Dry run — no writes."}\n`);

  /* 1. The bus itself. */
  const bus = await Bus.findById(BUS_ID);
  if (!bus) throw new Error(`Bus ${BUS_ID} not found — re-audit before migrating.`);

  const busIsStale = bus.takeOffDate.getTime() === FROM.getTime();
  const busIsFixed = bus.takeOffDate.getTime() === TO.getTime();

  if (!busIsStale && !busIsFixed) {
    throw new Error(
      `Bus ${BUS_ID} holds an unexpected takeOffDate (${bus.takeOffDate.toISOString()}). Refusing to touch it.`
    );
  }

  console.log("BUS");
  console.log(`    name          : ${bus.name}`);
  console.log(`    current       : ${show(bus.takeOffDate)}`);
  console.log(`    intended      : ${INTENDED_WALL_CLOCK} Nepal`);
  console.log(`    will become   : ${show(TO)}`);
  console.log(`    action        : ${busIsStale ? (APPLY ? "update" : "would update") : "already correct — skipped"}\n`);

  /* 2. The snapshots that copied the same instant. */
  const stale = await Booking.find({ takeOffDate: FROM }).select("_id bookingNumber takeOffDate").lean();
  const alreadyFixed = await Booking.countDocuments({ takeOffDate: TO });

  console.log("BOOKINGS");
  console.log(`    stale copies  : ${stale.length}`);
  console.log(`    already fixed : ${alreadyFixed}`);

  if (stale.length && stale.length !== EXPECTED_BOOKINGS) {
    throw new Error(
      `Expected ${EXPECTED_BOOKINGS} stale booking snapshots but found ${stale.length}. Refusing to write — re-audit first.`
    );
  }
  if (!busIsStale && !stale.length) {
    console.log("\nNothing to do — this migration has already been applied.");
    await mongoose.disconnect();
    return;
  }

  if (APPLY) {
    await Bus.updateOne({ _id: BUS_ID, takeOffDate: FROM }, { $set: { takeOffDate: TO } });
    const res = await Booking.updateMany({ takeOffDate: FROM }, { $set: { takeOffDate: TO } });
    console.log(`\nBookings updated         : ${res.modifiedCount}`);
    console.log(`Bus updated              : ${(await Bus.findById(BUS_ID)).takeOffDate.toISOString() === TO.toISOString()}`);
  } else {
    console.log(`\nWould update            : 1 bus + ${stale.length} bookings`);
  }

  /* 3. Verify. */
  const remaining = await Booking.countDocuments({ takeOffDate: FROM });
  const busNow = (await Bus.findById(BUS_ID)).takeOffDate;
  const showNow = `${formatTakeoffDate(busNow)} ${formatTakeoffTime(busNow)}`;

  console.log(`\nBus departure now       : ${busNow.toISOString()}  (${showNow})`);
  console.log(`Bookings still stale    : ${remaining}`);

  if (APPLY) {
    if (remaining > 0 || busNow.getTime() !== TO.getTime()) {
      console.error("Migration incomplete — re-run this script.");
      process.exitCode = 1;
    } else {
      console.log(`\nMigration complete. Tickets now show "${showNow}".`);
    }
  } else {
    console.log("\nThis was a dry run. Re-run with --apply to write the changes.");
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("\nMigration failed:", err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
