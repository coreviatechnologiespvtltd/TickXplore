import { FaUserTie } from "react-icons/fa";
import type { Bus } from "../api";
import { formatSeatLabel } from "../utils/ticket";

interface BusSeatGridProps {
  bus: Bus;
  selectedSeats: number[];
  covSeats?: number[];
  onToggle: (seatNumber: number) => void;
  title?: string;
}

const BusSeatGrid = ({
  bus,
  selectedSeats,
  covSeats = [],
  onToggle,
  title = "Choose your seats",
}: BusSeatGridProps) => {
  const booked = (bus.bookedSeats || []).map(Number);

  const seatStatus = (seatNumber: number): "booked" | "cov" | "selected" | "available" => {
    if (booked.includes(seatNumber)) return "booked";
    if (covSeats.includes(seatNumber)) return "cov";
    if (selectedSeats.includes(seatNumber)) return "selected";
    return "available";
  };

  const seatClasses: Record<string, string> = {
    booked: "bg-rose-500 text-white cursor-not-allowed shadow-sm",
    cov: "bg-blue-500 text-white cursor-not-allowed shadow-sm",
    selected: "bg-teal-500 text-white shadow-md ring-2 ring-teal-300",
    available:
      "bg-white border border-slate-300 text-slate-700 shadow-sm hover:border-teal-500 hover:bg-teal-50",
  };

  const availableCount = Math.max(
    0,
    bus.totalSeats - booked.length - covSeats.length
  );

  return (
    <section className="rounded-2xl bg-white p-5 shadow-card sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-900 sm:text-xl">{title}</h2>
        <span className="rounded-full bg-teal-100 px-3 py-1 text-sm font-semibold text-teal-700">
          {availableCount} available
        </span>
      </div>

      <div className="mb-4 flex items-center justify-between rounded-xl bg-gradient-to-r from-slate-100 to-slate-50 px-4 py-2.5">
        <FaUserTie size={22} className="text-slate-600" />
        <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
          Front
        </span>
      </div>

      <div className="mb-2 flex items-center gap-3 pl-2 sm:gap-4">
        <span className="rounded-md border border-dashed border-slate-400 px-2 py-0.5 text-xs font-semibold text-slate-500">
          DOOR
        </span>
        <span className="w-10 sm:w-12" />
      </div>

      <div className="overflow-x-auto">
        <div className="flex flex-col gap-2 sm:gap-3">
          {Array.from({ length: Math.ceil(bus.totalSeats / 4) }, (_, rowIndex) => {
            const rowLabel = String.fromCharCode(65 + rowIndex);
            return (
              <div key={rowLabel} className="flex items-center gap-3 pl-2 sm:gap-4">
                <span className="w-4 text-center text-xs font-bold text-slate-400 sm:w-6">
                  {rowLabel}
                </span>
                <div className="w-10 sm:w-12" />
                <div className="flex gap-1.5 sm:gap-2">
                  {[1, 2, 3, 4].map((colNum) => {
                    const seatNumber = rowIndex * 4 + colNum;
                    if (seatNumber > bus.totalSeats) return null;

                    const label = formatSeatLabel(seatNumber);
                    const status = seatStatus(seatNumber);

                    let gapStyle = "";
                    if (colNum === 2) gapStyle = "mr-12 sm:mr-20";
                    if (colNum === 1 || colNum === 3) gapStyle = "mr-2 sm:mr-4";

                    return (
                      <div key={seatNumber} className={gapStyle}>
                        <button
                          onClick={() => onToggle(seatNumber)}
                          disabled={status === "booked" || status === "cov"}
                          className={`h-11 w-11 rounded-lg text-sm font-bold transition-all sm:h-12 sm:w-12 ${seatClasses[status]}`}
                          data-seat-status={status}
                          data-seat-number={seatNumber}
                        >
                          {label}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-center text-xs font-bold uppercase tracking-widest text-slate-400">
          Rear
        </p>
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 border-t border-slate-100 pt-4">
        <div className="flex items-center">
          <span className="mr-2 h-4 w-4 rounded-md bg-teal-500 ring-2 ring-teal-300" />
          <span className="text-sm text-slate-600">Selected</span>
        </div>
        <div className="flex items-center">
          <span className="mr-2 h-4 w-4 rounded-md bg-rose-500" />
          <span className="text-sm text-slate-600">Booked</span>
        </div>
        <div className="flex items-center">
          <span className="mr-2 h-4 w-4 rounded-md bg-blue-500" />
          <span className="text-sm text-slate-600">Cash on Visit</span>
        </div>
        <div className="flex items-center">
          <span className="mr-2 h-4 w-4 rounded-md border border-slate-300 bg-white" />
          <span className="text-sm text-slate-600">Available</span>
        </div>
      </div>
    </section>
  );
};

export default BusSeatGrid;