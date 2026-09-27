import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "react-toastify";
import FormInput from "./Vendor_FormInput";
import { type Bus, type Vehicle } from "../../api";
import { toDateTimeLocalValue } from "../../utils/datetime";

interface SubmitResult {
  success?: boolean;
}

interface AddEditFormProps {
  vehicle?: Vehicle;
  bus?: Bus;
  isAdding: boolean;
  type: "buses" | "vehicles";
  onClose: () => void;
  onFetchData: () => void;
  addBus?: (payload: FormData) => Promise<SubmitResult>;
  updateBus?: (id: string, payload: FormData) => Promise<SubmitResult>;
  addVehicle?: (payload: FormData) => Promise<SubmitResult>;
  updateVehicle?: (id: string, payload: FormData) => Promise<SubmitResult>;
}

interface AddEditFormState {
  name: string;
  type: string;
  pricePerSeat: string;
  price: string;
  capacity: string;
  image: File | string;
  pickupPoint: string;
  dropPoint: string;
  totalSeats: string;
  isAvailable: boolean;
  takeOffDate: string;
  tripDate: string;
}

const AddEditForm = ({
  vehicle,
  bus,
  isAdding,
  type,
  onClose,
  onFetchData,
  addBus,
  updateBus,
  addVehicle,
  updateVehicle,
}: AddEditFormProps) => {
  const [formData, setFormData] = useState<AddEditFormState>({
    name: vehicle?.name || bus?.name || "",
    type: type === "vehicles" ? "Vehicle" : "Bus",
    pricePerSeat: bus?.pricePerSeat != null ? String(bus.pricePerSeat) : "",
    price: vehicle?.price != null ? String(vehicle.price) : "",
    capacity: vehicle?.capacity != null ? String(vehicle.capacity) : "",
    image: "",
    pickupPoint: bus?.pickupPoint || "",
    dropPoint: bus?.dropPoint || "",
    totalSeats: bus?.totalSeats != null ? String(bus.totalSeats) : "",
    isAvailable: vehicle?.isAvailable ?? true,
    takeOffDate:
      type === "buses" && bus?.takeOffDate ? toDateTimeLocalValue(bus.takeOffDate) : "",
    tripDate: bus?.tripDate || "",
  });

  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData({ ...formData, image: file });
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const update = <K extends keyof AddEditFormState>(key: K, value: AddEditFormState[K]) =>
    setFormData((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const vendorId = localStorage.getItem("vendorId");
      if (!vendorId) {
        toast.error("Vendor ID is missing. Please log in again.");
        return;
      }

      if (type === "buses" && !formData.takeOffDate) {
        toast.error("Please select a take-off date and time for the bus");
        return;
      }

      const formDataToSend = new FormData();
      formDataToSend.append("vendorId", vendorId);
      Object.entries(formData).forEach(([key, value]) => {
        if (key !== "image" && value) formDataToSend.append(key, String(value));
      });

      if (formData.image instanceof File) {
        formDataToSend.append("image", formData.image);
      }

      const response =
        type === "vehicles"
          ? isAdding
            ? await addVehicle?.(formDataToSend)
            : await updateVehicle?.(vehicle?._id ?? "", formDataToSend)
          : isAdding
            ? await addBus?.(formDataToSend)
            : await updateBus?.(bus?._id ?? "", formDataToSend);

      if (response?.success) {
        toast.success(
          `${type === "vehicles" ? "Vehicle" : "Bus"} ${
            isAdding ? "added" : "updated"
          } successfully!`
        );
        onFetchData();
        onClose();
      }
    } catch (error) {
      console.error("Error submitting form:", error);
      const axiosErr = error as { response?: { data?: { message?: string } } };
      toast.error(axiosErr.response?.data?.message || "Failed to submit form.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-edit-form-title"
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-2xl space-y-4 rounded-xl bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 id="add-edit-form-title" className="text-2xl font-bold">
              {isAdding
                ? `Add New ${type === "vehicles" ? "Vehicle" : "Bus"}`
                : `Edit ${type === "vehicles" ? "Vehicle" : "Bus"}`}
            </h2>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              aria-label="Close dialog"
              className="rounded-md p-1 text-gray-500 transition-colors hover:bg-slate-100 hover:text-gray-700"
            >
              ✕
            </button>
          </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormInput
            label="Name"
            name="name"
            value={formData.name}
            onChange={(e) => update("name", e.target.value)}
          />

          {type === "vehicles" ? (
            <FormInput
              label="Price"
              type="number"
              name="price"
              value={formData.price}
              onChange={(e) => update("price", e.target.value)}
            />
          ) : (
            <FormInput
              label="Price per Seat"
              type="number"
              name="pricePerSeat"
              value={formData.pricePerSeat}
              onChange={(e) => update("pricePerSeat", e.target.value)}
            />
          )}

          {type === "buses" && (
            <>
              <FormInput
                label="Pickup Point"
                name="pickupPoint"
                value={formData.pickupPoint}
                onChange={(e) => update("pickupPoint", e.target.value)}
              />
              <FormInput
                label="Drop Point"
                name="dropPoint"
                value={formData.dropPoint}
                onChange={(e) => update("dropPoint", e.target.value)}
              />
            </>
          )}

          {type === "buses" ? (
            <FormInput
              label="Total Seats"
              type="number"
              name="totalSeats"
              value={formData.totalSeats}
              onChange={(e) => update("totalSeats", e.target.value)}
            />
          ) : (
            <FormInput
              label="Capacity"
              type="number"
              name="capacity"
              value={formData.capacity}
              onChange={(e) => update("capacity", e.target.value)}
            />
          )}

          {type === "buses" && (
            <FormInput
              label="Take Off Date & Time"
              type="datetime-local"
              name="takeOffDate"
              value={formData.takeOffDate}
              onChange={(e) => update("takeOffDate", e.target.value)}
            />
          )}

          <div className="col-span-2">
            <label className="text-sm font-medium text-gray-700">Upload Image</label>
            <input
              type="file"
              accept="image/*"
              className="w-full rounded-lg border p-2 focus:ring-2 focus:ring-indigo-500"
              onChange={handleImageChange}
            />
            {imagePreview && (
              <div className="mt-2">
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="h-32 w-32 rounded-lg object-cover"
                />
              </div>
            )}
          </div>

          <div className="col-span-2 mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-4 py-2 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
            >
              {isSubmitting ? "Submitting..." : isAdding ? "Add" : "Save Changes"}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
};

export default AddEditForm;