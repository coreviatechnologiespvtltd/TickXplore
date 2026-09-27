/**
 * Guards the rule that the in-app ticket and the emailed PDF can never disagree.
 *
 * The frontend and the backend each format take-off dates and seat labels from
 * their own copy of the rules, so a change on one side that isn't mirrored on
 * the other would silently show a customer one value in the app and another in
 * their inbox. This compares the two implementations value for value.
 *
 *   cd Front_End
 *   npm run check:ticket-parity
 */
import * as beDate from "../../Back_End/utils/datetime.js";
import * as beTicket from "../../Back_End/utils/ticketView.js";
import {
  currentYear,
  dateKey,
  formatTakeoffDate,
  formatTakeoffDateTime,
  formatTakeoffTime,
  parseTakeoffInput,
  toDateTimeLocalValue,
} from "../src/utils/datetime";
import { buildTicketView, formatSeatLabel, isPopulated } from "../src/utils/ticket";

let failures = 0;
let checks = 0;

const eq = (label: string, got: unknown, want: unknown) => {
  checks += 1;
  if (String(got) === String(want)) return;
  failures += 1;
  console.log(`FAIL  ${label}\n        frontend=${got}\n        backend =${want}`);
};

const dateSamples: Array<string | Date | null> = [
  null,
  undefined,
  "not-a-date",
  "2026-09-27T07:30",
  "2026-09-27 07:30",
  "2026-09-27",
  "2026-01-01T00:15", // 12 AM edge
  "2026-12-31T23:45", // 11:45 PM edge
  "2025-05-25T01:30:00.000Z",
  "2026-09-27T07:30:00Z",
  "2026-09-27T07:30:00+05:45",
  "2024-02-29T12:00", // leap day
  "2026-03-08T02:30:00.000Z", // the +05:45 offset, not a DST boundary
  new Date("2026-06-15T18:30:00.000Z"),
  new Date("2026-12-31T18:30:00.000Z"), // Nepali new year
  new Date("2027-01-01T00:00:00.000Z"),
];

console.log("--- take-off formatting parity ---");
for (const s of dateSamples) {
  const tag = s instanceof Date ? s.toISOString() : JSON.stringify(s);
  eq(`formatTakeoffDate(${tag})`, formatTakeoffDate(s as never), beDate.formatTakeoffDate(s as never));
  eq(`formatTakeoffTime(${tag})`, formatTakeoffTime(s as never), beDate.formatTakeoffTime(s as never));
  eq(`formatTakeoffDateTime(${tag})`, formatTakeoffDateTime(s as never), beDate.formatTakeoffDateTime(s as never));
  eq(`dateKey(${tag})`, dateKey(s as never), beDate.dateKey(s as never));
  eq(`currentYear(${tag})`, currentYear(s as never), beDate.currentYear(s as never));
}

console.log("--- take-off parsing parity (form write path) ---");
for (const s of ["2026-09-27T07:30", "2026-09-27 07:30", "2026-09-27", "2026-09-27T07:30:00Z", "bad"]) {
  const fe = parseTakeoffInput(s);
  const be = beDate.parseTakeoffInput(s);
  eq(`parseTakeoffInput(${JSON.stringify(s)})`, fe?.toISOString() ?? null, be?.toISOString() ?? null);
}

console.log("--- datetime-local round trip (vendor edit form) ---");
for (const s of ["2026-09-27T07:30", "2026-01-01T00:15", "2026-12-31T23:45"]) {
  const d = parseTakeoffInput(s)!;
  const local = toDateTimeLocalValue(d);
  eq(`round trip ${s}`, local, s);
  eq(`round trip keeps instant ${s}`, parseTakeoffInput(local)!.toISOString(), d.toISOString());
}

console.log("--- seat label parity ---");
for (let n = 1; n <= 40; n += 1) {
  eq(`formatSeatLabel(${n})`, formatSeatLabel(n), beTicket.formatSeatLabel(n));
}
for (const bad of ["0", "-3", "abc", "", 999]) {
  eq(`formatSeatLabel(${JSON.stringify(bad)})`, formatSeatLabel(bad), beTicket.formatSeatLabel(bad));
}

console.log("--- ticket view parity ---");
const booking = {
  _id: "abc123",
  bookingNumber: "20260042",
  busId: {
    name: "Mountain Express",
    pickupPoint: "Kathmandu",
    dropPoint: "Pokhara",
    takeOffDate: "2026-09-27T01:45:00.000Z",
  } as never,
  customerName: "Ram Thapa",
  customerPhone: "9800000000",
  selectedSeats: [1, 2, 5, 6],
  totalPrice: 3200,
  status: "Booked",
  paymentStatus: "Paid",
  takeOffDate: "2026-09-27T01:45:00.000Z",
  passengers: [{ name: "Ram Thapa", phone: "9800000000", seat: 1 }],
  emailStatus: "Sent",
};

async function checkTicketView() {
  const fe = buildTicketView(booking);
  const be = await beTicket.buildTicketView(booking);
  // The fixture carries an already-populated `busId`, so both sides resolve the
  // same bus and every field is comparable, busName included.
  for (const key of Object.keys(fe) as Array<keyof typeof fe>) {
    eq(`ticketView.${String(key)}`, JSON.stringify(fe[key]), JSON.stringify(be[key]));
  }

  /* A BSON ObjectId is also `typeof "object"`. If either side mistakes one for a
     populated document it skips the Bus lookup and the ticket prints "N/A" for
     the operator, so both predicates have to agree on every shape. */
  const oidLike = (extra: Record<string, unknown>) => extra;
  const populatedDoc = { name: "Mountain Express", pickupPoint: "Kathmandu" };
  const realObjectIdShape = {
    _bsontype: "ObjectId",
    toHexString: () => "6ab14c0a3c14874ce9c13f14",
    equals: () => false,
  };
  const toHexStringOnly = { toHexString: () => "6ab14c0a3c14874ce9c13f14", equals: () => false };
  const matrix: Array<[string, unknown]> = [
    ["ObjectId (_bsontype)", realObjectIdShape],
    ["legacy _bsontype", oidLike({ _bsontype: "ObjectID" })],
    ["toHexString+equals only", toHexStringOnly],
    ["hex id string", "6ab14c0a3c14874ce9c13f14"],
    ["number id", 42],
    ["zero", 0],
    ["null", null],
    ["undefined", undefined],
    ["populated document", populatedDoc],
    ["empty object", {}],
  ];
  for (const [label, ref] of matrix) {
    eq(`isPopulated(${label})`, isPopulated(ref), beTicket.isPopulated(ref));
  }
  /* The three id shapes must be rejected, or the ticket falls back to "N/A". */
  eq("isPopulated rejects a bare ObjectId", isPopulated(realObjectIdShape), false);
  eq("isPopulated rejects a hex id", isPopulated("6ab14c0a3c14874ce9c13f14"), false);
  eq("isPopulated accepts a populated document", isPopulated(populatedDoc), true);

  console.log("");
  if (failures) {
    console.error(`${failures} of ${checks} parity checks failed.`);
    process.exit(1);
  }
  console.log(`OK: ${checks} checks — frontend and backend produce identical ticket values.`);
}

checkTicketView().catch((err) => {
  console.error(err);
  process.exit(1);
});

