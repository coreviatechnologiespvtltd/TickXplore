/**
 * Hotel dashboard — house policies.
 * ------------------------------------------------------------------
 * Check-in / check-out times, stay-length limits, the structured cancellation
 * policy (threshold tiers rather than free text, so the public page can render
 * a refund table), house rules, and the child / pet policies.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { FiPlus, FiSave, FiTrash2 } from "react-icons/fi";
import { apiErrorMessage, hotelApi, type CancellationTier, type HotelPolicies } from "../../api/hotel";
import { useHotelDashboard } from "./context";
import { Alert, Button, Card, Field, Input, PageHeader, Textarea } from "./ui";

/* ------------------------------------------------------------------ */
/* Form                                                                 */
/* ------------------------------------------------------------------ */

interface TierDraft {
  key: string;
  daysBeforeCheckIn: string;
  refundPercent: string;
  label: string;
}

interface PolicyForm {
  checkInTime: string;
  checkOutTime: string;
  minStayNights: string;
  maxStayNights: string;
  freeCancellationDays: string;
  nonRefundableAfterDays: string;
  notes: string;
  houseRules: string;
  childrenPolicy: string;
  petPolicy: string;
  tiers: TierDraft[];
}

const tierKey = () => `tier-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const toForm = (policies: HotelPolicies): PolicyForm => ({
  checkInTime: policies.checkInTime ?? "14:00",
  checkOutTime: policies.checkOutTime ?? "11:00",
  minStayNights: String(policies.minStayNights ?? 1),
  maxStayNights: String(policies.maxStayNights ?? 30),
  freeCancellationDays: String(policies.cancellationPolicy?.freeCancellationDays ?? 3),
  nonRefundableAfterDays: String(policies.cancellationPolicy?.nonRefundableAfterDays ?? 0),
  notes: policies.cancellationPolicy?.notes ?? "",
  houseRules: (policies.houseRules ?? []).join("\n"),
  childrenPolicy: policies.childrenPolicy ?? "",
  petPolicy: policies.petPolicy ?? "",
  tiers: (policies.cancellationPolicy?.tiers ?? []).map((tier, index) => ({
    key: `tier-${index}`,
    daysBeforeCheckIn: String(tier.daysBeforeCheckIn),
    refundPercent: String(tier.refundPercent),
    label: tier.label ?? "",
  })),
});

const emptyForm = (): PolicyForm => ({
  checkInTime: "14:00",
  checkOutTime: "11:00",
  minStayNights: "1",
  maxStayNights: "30",
  freeCancellationDays: "3",
  nonRefundableAfterDays: "0",
  notes: "",
  houseRules: "",
  childrenPolicy: "",
  petPolicy: "",
  tiers: [
    { key: tierKey(), daysBeforeCheckIn: "7", refundPercent: "100", label: "Free cancellation" },
    { key: tierKey(), daysBeforeCheckIn: "2", refundPercent: "50", label: "Partial refund" },
    { key: tierKey(), daysBeforeCheckIn: "0", refundPercent: "0", label: "Non-refundable" },
  ],
});

/* ------------------------------------------------------------------ */

const HotelPolicies = () => {
  const { hotel, refresh } = useHotelDashboard();

  const [form, setForm] = useState<PolicyForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(hotel?.policies ? toForm(hotel.policies) : emptyForm());
  }, [hotel]);

  const set = <K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const errors = useMemo(() => {
    if (!form) return [];
    const list: string[] = [];
    const min = Number(form.minStayNights);
    const max = Number(form.maxStayNights);

    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(form.checkInTime))
      list.push("Check-in time must be a 24-hour time such as 14:00.");
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(form.checkOutTime))
      list.push("Check-out time must be a 24-hour time such as 11:00.");
    if (!Number.isInteger(min) || min < 1 || min > 365)
      list.push("Minimum stay must be between 1 and 365 nights.");
    if (!Number.isInteger(max) || max < 1 || max > 365)
      list.push("Maximum stay must be between 1 and 365 nights.");
    if (min > max) list.push("Maximum stay must be greater than or equal to the minimum stay.");

    const free = Number(form.freeCancellationDays);
    const nonRefundable = Number(form.nonRefundableAfterDays);
    if (Number.isNaN(free) || free < 0 || free > 365)
      list.push("Free-cancellation window must be between 0 and 365 days.");
    if (Number.isNaN(nonRefundable) || nonRefundable < 0 || nonRefundable > 365)
      list.push("Non-refundable threshold must be between 0 and 365 days.");
    if (nonRefundable < free)
      list.push("The non-refundable threshold cannot be lower than the free-cancellation window.");

    const seen = new Set<number>();
    for (const tier of form.tiers) {
      const days = Number(tier.daysBeforeCheckIn);
      if (Number.isNaN(days) || days < 0 || days > 365) {
        list.push("Each cancellation tier needs a threshold between 0 and 365 days.");
        break;
      }
      if (seen.has(days)) {
        list.push(`There is more than one cancellation tier at ${days} day(s) before check-in.`);
        break;
      }
      seen.add(days);

      const refund = Number(tier.refundPercent);
      if (Number.isNaN(refund) || refund < 0 || refund > 100) {
        list.push("Each cancellation tier needs a refund between 0% and 100%.");
        break;
      }
    }

    return list;
  }, [form]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }

    const tiers: CancellationTier[] = form.tiers
      .filter((tier) => tier.daysBeforeCheckIn.trim() !== "")
      .map((tier) => ({
        daysBeforeCheckIn: Number(tier.daysBeforeCheckIn),
        refundPercent: Number(tier.refundPercent),
        label: tier.label.trim() || undefined,
      }))
      .sort((a, b) => b.daysBeforeCheckIn - a.daysBeforeCheckIn);

    setSaving(true);
    setError("");
    try {
      await hotelApi.updatePolicies({
        checkInTime: form.checkInTime,
        checkOutTime: form.checkOutTime,
        minStayNights: Number(form.minStayNights),
        maxStayNights: Number(form.maxStayNights),
        cancellationPolicy: {
          freeCancellationDays: Number(form.freeCancellationDays),
          nonRefundableAfterDays: Number(form.nonRefundableAfterDays),
          notes: form.notes.trim(),
          tiers,
        },
        houseRules: form.houseRules
          .split(/\n/)
          .map((rule) => rule.trim())
          .filter(Boolean),
        childrenPolicy: form.childrenPolicy.trim(),
        petPolicy: form.petPolicy.trim(),
      });

      await refresh();
      toast.success("Policies saved.");
    } catch (saveError) {
      const message = apiErrorMessage(saveError, "Could not save the policies.");
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (!form) return null;

  const updateTier = (key: string, patch: Partial<TierDraft>) =>
    setForm((prev) =>
      prev
        ? { ...prev, tiers: prev.tiers.map((tier) => (tier.key === key ? { ...tier, ...patch } : tier)) }
        : prev
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="House policies"
        subtitle="Shown on your public listing. Cancellation tiers are shown to guests as a refund table."
      />

      <form onSubmit={save} className="space-y-6">
        {error && <Alert tone="danger">{error}</Alert>}

        {/* -------------------------- stay rules -------------------------- */}
        <Card title="Check-in, check-out and stay length">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Check-in time" required hint="24-hour format">
              <Input
                type="time"
                value={form.checkInTime}
                onChange={(event) => set("checkInTime", event.target.value)}
              />
            </Field>

            <Field label="Check-out time" required hint="24-hour format">
              <Input
                type="time"
                value={form.checkOutTime}
                onChange={(event) => set("checkOutTime", event.target.value)}
              />
            </Field>

            <Field label="Minimum stay" required hint="1 – 365 nights">
              <Input
                type="number"
                min={1}
                max={365}
                value={form.minStayNights}
                onChange={(event) => set("minStayNights", event.target.value)}
              />
            </Field>

            <Field label="Maximum stay" required hint="1 – 365 nights">
              <Input
                type="number"
                min={1}
                max={365}
                value={form.maxStayNights}
                onChange={(event) => set("maxStayNights", event.target.value)}
              />
            </Field>
          </div>
        </Card>

        {/* ------------------------ cancellation ------------------------ */}
        <Card
          title="Cancellation policy"
          description="Each tier is a threshold: when a guest cancels at least this many days before arrival, they get that percentage back."
        >
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Free cancellation up to" hint="Days before check-in.">
              <Input
                type="number"
                min={0}
                max={365}
                value={form.freeCancellationDays}
                onChange={(event) => set("freeCancellationDays", event.target.value)}
              />
            </Field>

            <Field
              label="Non-refundable within"
              hint="Days before check-in. Cannot be lower than the free-cancellation window."
            >
              <Input
                type="number"
                min={0}
                max={365}
                value={form.nonRefundableAfterDays}
                onChange={(event) => set("nonRefundableAfterDays", event.target.value)}
              />
            </Field>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Refund tiers</p>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  set("tiers", [
                    ...form.tiers,
                    { key: tierKey(), daysBeforeCheckIn: "", refundPercent: "50", label: "" },
                  ])
                }
                className="!px-3 !py-1.5"
              >
                <FiPlus size={14} /> Add tier
              </Button>
            </div>

            {form.tiers.length === 0 ? (
              <p className="text-sm text-slate-500">
                No tiers. Without them, only the free-cancellation window above applies.
              </p>
            ) : (
              <ul className="space-y-2">
                {form.tiers.map((tier) => (
                  <li key={tier.key} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-12">
                    <Field label="Days before" className="sm:col-span-3">
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        value={tier.daysBeforeCheckIn}
                        onChange={(event) =>
                          updateTier(tier.key, { daysBeforeCheckIn: event.target.value })
                        }
                      />
                    </Field>

                    <Field label="Refund %" className="sm:col-span-3">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={tier.refundPercent}
                        onChange={(event) =>
                          updateTier(tier.key, { refundPercent: event.target.value })
                        }
                      />
                    </Field>

                    <Field label="Label" className="sm:col-span-5">
                      <Input
                        value={tier.label}
                        onChange={(event) => updateTier(tier.key, { label: event.target.value })}
                        placeholder="e.g. Free cancellation"
                        maxLength={120}
                      />
                    </Field>

                    <button
                      type="button"
                      onClick={() =>
                        set(
                          "tiers",
                          form.tiers.filter((item) => item.key !== tier.key)
                        )
                      }
                      aria-label="Remove tier"
                      className="mb-2.5 rounded-lg p-2 text-rose-500 transition-colors hover:bg-rose-50"
                    >
                      <FiTrash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-5">
            <Field label="Cancellation notes" hint="Optional free text shown under the table.">
              <Textarea
                value={form.notes}
                onChange={(event) => set("notes", event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="e.g. No-shows are charged in full."
              />
            </Field>
          </div>
        </Card>

        {/* ------------------------- house rules ------------------------- */}
        <Card
          title="House rules"
          description="One rule per line. Maximum 30 rules."
        >
          <Field label="Rules">
            <Textarea
              value={form.houseRules}
              onChange={(event) => set("houseRules", event.target.value)}
              rows={5}
              placeholder={"No smoking\nQuiet hours 10:00 PM – 7:00 AM\nNo parties"}
            />
          </Field>
          <p className="mt-1 text-xs text-slate-500">
            {form.houseRules.split("\n").filter((line) => line.trim()).length} rule(s)
          </p>
        </Card>

        {/* ---------------------- children and pets ---------------------- */}
        <Card title="Children and pets">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="Children policy">
              <Textarea
                value={form.childrenPolicy}
                onChange={(event) => set("childrenPolicy", event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="e.g. Children under 6 stay free; extra beds on request."
              />
            </Field>

            <Field label="Pet policy">
              <Textarea
                value={form.petPolicy}
                onChange={(event) => set("petPolicy", event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="e.g. Small pets welcome in garden rooms only."
              />
            </Field>
          </div>
        </Card>

        {errors.length > 0 && (
          <Alert tone="danger">
            <ul className="list-inside list-disc space-y-0.5">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button type="submit" busy={saving} disabled={errors.length > 0}>
            <FiSave size={16} /> Save policies
          </Button>
        </div>
      </form>
    </div>
  );
};

export default HotelPolicies;
