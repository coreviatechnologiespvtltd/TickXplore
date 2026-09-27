import {
  FaBus,
  FaCar,
  FaMapMarkerAlt,
  FaRoute,
  FaChair,
} from "react-icons/fa";
import { AiOutlineCalendar } from "react-icons/ai";
import { IoMdArrowForward } from "react-icons/io";
import type { Bus, Vehicle } from "../api";

export interface BusEnriched extends Bus {
  imageUrl?: string;
  availableSeats?: number;
  price?: number | "N/A";
}

export interface VehicleEnriched extends Omit<Vehicle, "price"> {
  imageUrl?: string;
  price?: number | "N/A";
}

interface TransportCardProps {
  data: BusEnriched | VehicleEnriched;
  onSelect: () => void;
  type: "bus" | "vehicle";
}

const TransportCard = ({ data, onSelect, type }: TransportCardProps) => {
  if (!data || !data.name) return null;
  const image = data.imageUrl;

  const dateInfo =
    type === "bus"
      ? data.takeOffDate
        ? new Date(data.takeOffDate).toLocaleDateString("en-US", {
            weekday: "short",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Date not set"
      : "Flexible Reservation Date";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-card transition-shadow hover:shadow-card-lg md:flex-row">
      <div className="relative md:w-52 md:shrink-0">
        {image ? (
          <img
            src={image}
            alt={data.name}
            className="h-44 w-full object-cover md:h-full md:w-full"
          />
        ) : (
          <div className="flex h-44 w-full items-center justify-center bg-slate-100 text-4xl text-slate-300 md:h-full md:w-full">
            {type === "bus" ? <FaBus /> : <FaCar />}
          </div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-slate-900/70 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
          {type === "bus" ? "Bus" : "Vehicle"}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 className="text-xl font-bold text-slate-900">{data.name}</h3>
        {type === "vehicle" && (!data.pickupPoint || !data.dropPoint) ? (
          <div className="flex w-fit max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-full bg-amber-500/10 px-4 py-1.5 text-sm font-semibold text-amber-700">
            <FaRoute className="shrink-0" />
            Flexible route — contact vendor
          </div>
        ) : (
          <div className="flex w-fit max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-full bg-blue-600/10 px-4 py-1.5 text-sm font-semibold text-blue-700">
            <span className="flex items-center gap-1">
              <FaMapMarkerAlt /> {data.pickupPoint || "N/A"}
            </span>
            <IoMdArrowForward className="shrink-0 text-slate-400" />
            <span className="flex items-center gap-1">
              <FaMapMarkerAlt /> {data.dropPoint || "N/A"}
            </span>
          </div>
        )}

        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
          <p className="flex items-center gap-1.5">
            <AiOutlineCalendar className="text-blue-500" />
            {dateInfo}
          </p>
          {type === "bus" && (
            <p className="flex items-center gap-1.5">
              <FaChair className="text-blue-500" />
              Available: {(data as BusEnriched).availableSeats || 0}/{data.totalSeats || 0}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-slate-100 p-5 md:w-52 md:shrink-0 md:flex-col md:items-end md:justify-center md:border-l md:border-t-0">
        <div>
          <p className="text-2xl font-bold text-emerald-600">
            NPR{" "}
            {typeof data.price === "number"
              ? data.price.toLocaleString()
              : "N/A"}
          </p>
          <p className="text-sm text-slate-500">
            per {type === "bus" ? "seat" : "vehicle"}
          </p>
        </div>
        <button
          onClick={onSelect}
          className="shrink-0 rounded-xl bg-blue-600 px-5 py-2.5 font-semibold text-white transition-colors hover:bg-blue-900"
        >
          {type === "bus" ? "View Seats" : "Book Vehicle"}
        </button>
      </div>
    </div>
  );
};

export default TransportCard;
