import { useEffect, useMemo, useState } from "react";
import { getPageRange } from "../../utils/pagination";
import type { ReactNode } from "react";

export interface Column<T = Record<string, unknown>> {
  key: string;
  label: string;
  render?: (value: unknown, row: T) => ReactNode;
  badge?: boolean;
}

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

// Old API props (for backward compatibility)
interface LegacyDataTableProps<T extends { _id?: string }> {
  title?: string;
  data: T[];
  fields: string[];
  headers?: string[];
  renderCell?: (item: T, field: string) => string | number | null;
  onDelete?: (id: string) => void;
  onToggleStatus?: (id: string) => void;
  onApproveStatus?: (id: string) => void;
  onDeclineStatus?: (id: string) => void;
  disableDelete?: (item: T) => boolean;
  hideTitle?: boolean;
  pageSize?: number;
}

// New API props
interface ModernDataTableProps<T extends { _id?: string }> {
  data: T[];
  columns: Column<T>[];
  loading?: boolean;
  emptyMessage?: string;
  renderActions?: (row: T) => ReactNode;
  customCellRenderers?: Record<string, (value: unknown, row: T) => ReactNode>;
  pagination?: PaginationProps;
  className?: string;
}

// Combined props - accept both old and new API
interface AdminDataTableProps<T extends { _id?: string }> 
  extends Partial<LegacyDataTableProps<T>>, Partial<ModernDataTableProps<T>> {
  // Must have data
  data: T[];
}

const getCellValue = (value: unknown): string => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") {
    const obj = value as { name?: string; _id?: string };
    return obj.name || obj._id || JSON.stringify(value);
  }
  return String(value);
};

const resolvePath = (obj: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>((acc, key) =>
      acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      obj);

// Convert old API (fields/headers) to new API (columns)
function convertLegacyToColumns<T extends { _id?: string }>(
  fields: string[],
  headers?: string[],
  renderCell?: (item: T, field: string) => string | number | null
): Column<T>[] {
  return fields.map((field, index) => ({
    key: field,
    label: headers?.[index] || field,
    render: renderCell
      ? (value: unknown, row: T) => {
          const rendered = renderCell(row, field);
          return rendered !== null && rendered !== undefined ? String(rendered) : getCellValue(value);
        }
      : undefined,
  }));
}

const Admin_DataTable = <T extends { _id?: string }>({
  // New API props
  data,
  columns: newColumns,
  loading = false,
  emptyMessage = "No data available",
  renderActions,
  customCellRenderers = {},
  pagination,
  className = "",

  // Legacy API props
  title,
  fields,
  headers,
  renderCell,
  onDelete,
  onToggleStatus,
  onApproveStatus,
  onDeclineStatus,
  disableDelete,
  hideTitle = false,
  pageSize = 10,
}: AdminDataTableProps<T>) => {
  const [page, setPage] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState<T | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    item: T;
    action: "activate" | "deactivate" | "approve" | "decline";
  } | null>(null);

  // Determine which API is being used
  const isLegacyApi = !!fields && !newColumns;

  // Convert legacy props to modern columns if needed
  const columns: Column<T>[] = useMemo(() => {
    if (isLegacyApi && fields) {
      return convertLegacyToColumns(fields, headers, renderCell);
    }
    return newColumns || [];
  }, [isLegacyApi, fields, headers, renderCell, newColumns]);

  // Handle external pagination (new API) vs internal (legacy)
  const isExternalPagination = !!pagination;
  const currentPage = isExternalPagination ? pagination.currentPage : page;
  const totalPages = isExternalPagination
    ? pagination.totalPages
    : Math.max(1, Math.ceil(data.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const pagedData = useMemo(() => {
    if (isExternalPagination) return data;
    const start = (safePage - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, safePage, pageSize, isExternalPagination]);

  useEffect(() => {
    if (!isExternalPagination && page > totalPages) setPage(totalPages);
  }, [page, totalPages, isExternalPagination]);

  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, data.length);

  const renderCellContent = (item: T, column: Column<T>): ReactNode => {
    try {
      const rawValue = column.key.includes(".")
        ? resolvePath(item, column.key)
        : (item as Record<string, unknown>)[column.key];

      // Check for custom renderer (new API)
      if (customCellRenderers[column.key]) {
        return customCellRenderers[column.key](rawValue, item);
      }

      // Check for column-specific render (new API)
      if (column.render) {
        return column.render(rawValue, item);
      }

      // Default rendering
      return getCellValue(rawValue);
    } catch (error) {
      console.error(`Error rendering cell for field ${column.key}:`, error);
      return "Error";
    }
  };

  // Legacy status/action rendering
  const appStatus = (item: T): string =>
    String((item as Record<string, unknown>).applicationStatus ?? "");

  const decisionText: Record<string, { label: string; confirm: string; buttonClass: string }> = {
    activate: { label: "activate", confirm: "Activate", buttonClass: "bg-emerald-600 hover:bg-emerald-700" },
    deactivate: { label: "deactivate", confirm: "Deactivate", buttonClass: "bg-rose-600 hover:bg-rose-700" },
    approve: { label: "accept", confirm: "Accept", buttonClass: "bg-emerald-600 hover:bg-emerald-700" },
    decline: { label: "decline", confirm: "Decline", buttonClass: "bg-rose-600 hover:bg-rose-700" },
  };

  if (loading) {
    return (
      <div className={`rounded-2xl bg-white p-6 shadow-card ${className}`}>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      </div>
    );
  }

  // Legacy confirm dialogs
  const renderLegacyDialogs = () => (
    <>
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-card-lg">
            <h2 className="mb-4 text-xl font-bold text-gray-800">Confirm Deletion</h2>
            <p className="mb-6 text-gray-500">
              Are you sure you want to delete this item? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded-xl bg-gray-200 px-4 py-2 text-gray-700 transition hover:bg-gray-300"
              >
                No
              </button>
              <button
                onClick={() => {
                  onDelete?.(confirmDelete._id!);
                  setConfirmDelete(null);
                }}
                className="rounded-xl bg-rose-600 px-4 py-2 text-white transition hover:bg-rose-700"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-card-lg">
            <h2 className="mb-4 text-xl font-bold text-gray-800">
              Confirm {decisionText[confirmAction.action]?.confirm}
            </h2>
            <p className="mb-6 text-gray-500">
              Are you sure you want to{" "}
              {decisionText[confirmAction.action]?.label} this item?
            </p>
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setConfirmAction(null)}
                className="rounded-xl bg-gray-200 px-4 py-2 text-gray-700 transition hover:bg-gray-300"
              >
                No
              </button>
              <button
                onClick={() => {
                  const { item, action } = confirmAction;
                  if (action === "approve") onApproveStatus?.(item._id!);
                  else if (action === "decline") onDeclineStatus?.(item._id!);
                  else onToggleStatus?.(item._id!);
                  setConfirmAction(null);
                }}
                className={`rounded-xl px-4 py-2 text-white transition ${decisionText[confirmAction.action]?.buttonClass}`}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Legacy status/action cell
  const renderLegacyStatusCell = (item: T) => {
    if (onToggleStatus || onApproveStatus) {
      return (
        <td className="border border-gray-300 px-4 py-3">
          {appStatus(item) === "pending" || appStatus(item) === "declined" ? (
            <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">
              {appStatus(item) === "declined" && (
                <span className="rounded-md bg-rose-100 px-3 py-1 text-rose-700">Declined</span>
              )}
              <button
                onClick={() => setConfirmAction({ item, action: "approve" })}
                className="rounded-md bg-emerald-600 px-3 py-1 text-white transition-colors hover:bg-emerald-700"
              >
                Accept
              </button>
              {appStatus(item) === "pending" && (
                <button
                  onClick={() => setConfirmAction({ item, action: "decline" })}
                  className="rounded-md bg-rose-600 px-3 py-1 text-white transition-colors hover:bg-rose-700"
                >
                  Decline
                </button>
              )}
            </div>
          ) : onToggleStatus && (
            <button
              onClick={() =>
                setConfirmAction({
                  item,
                  action: (item as Record<string, unknown>).isActive ? "deactivate" : "activate",
                })
              }
              className={`rounded-md px-3 py-1 whitespace-nowrap text-white ${
                (item as Record<string, unknown>).isActive
                  ? "bg-rose-600 hover:bg-rose-700"
                  : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {(item as Record<string, unknown>).isActive ? "Deactivate" : "Activate"}
            </button>
          )}
        </td>
      );
    }
    return null;
  };

  // Legacy delete action cell
  const renderLegacyDeleteCell = (item: T) => {
    if (onDelete) {
      return (
        <td className="border border-gray-300 px-4 py-3">
          <div className="flex gap-2 whitespace-nowrap">
            {!disableDelete?.(item) && (
              <button
                onClick={() => setConfirmDelete(item)}
                className="rounded-md bg-rose-500 px-3 py-1 whitespace-nowrap text-white transition-colors hover:bg-rose-600"
              >
                Delete
              </button>
            )}
          </div>
        </td>
      );
    }
    return null;
  };

  // Legacy title
  const renderLegacyTitle = () => {
    if (isLegacyApi && !hideTitle && title) {
      return <h2 className="mb-6 text-2xl font-semibold text-slate-800">{title}</h2>;
    }
    return null;
  };

  return (
    <div className={`rounded-2xl bg-white p-6 shadow-card ${className}`}>
      {renderLegacyDialogs()}
      {renderLegacyTitle()}

      <div className="overflow-x-auto">
        {data.length === 0 ? (
          <div className="py-12 text-center text-gray-500">{emptyMessage}</div>
        ) : (
          <table className="w-full border rounded-lg border-gray-300">
            <thead>
              <tr className="bg-indigo-600 text-white">
                {columns.map((column, idx) => (
                  <th
                    key={idx}
                    className="border border-gray-300 px-4 py-3 whitespace-nowrap text-left"
                  >
                    {column.label}
                  </th>
                ))}
                {(renderActions || (isLegacyApi && (onToggleStatus || onApproveStatus))) && (
                  <th className="border border-gray-300 px-6 py-3 text-left">Status</th>
                )}
                {(renderActions || (isLegacyApi && onDelete)) && (
                  <th className="border border-gray-300 px-6 py-3 text-left">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {pagedData.map((item, index) => (
                <tr
                  key={item._id ?? index}
                  className="border border-gray-300 bg-white transition-colors hover:bg-slate-50"
                >
                  {columns.map((column, i) => (
                    <td
                      key={i}
                      className="break-words border border-gray-300 px-4 py-3 text-justify"
                    >
                      {renderCellContent(item, column)}
                    </td>
                  ))}
                  {renderActions ? (
                    <td className="border border-gray-300 px-4 py-3">
                      <div className="flex items-center gap-2">{renderActions(item)}</div>
                    </td>
                  ) : (
                    <>
                      {renderLegacyStatusCell(item)}
                      {renderLegacyDeleteCell(item)}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data.length > 0 && (
        <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm text-gray-500">
            {isExternalPagination
              ? `Page ${currentPage} of ${totalPages}`
              : `Showing ${startIndex + 1}-${endIndex} of ${data.length}`}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-1">
            <button
              onClick={() => {
                if (isExternalPagination) pagination?.onPageChange(currentPage - 1);
                else setPage((p) => Math.max(1, p - 1));
              }}
              disabled={safePage === 1}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            {getPageRange(safePage, totalPages).map((p, i) =>
              p === "..." ? (
                <span
                  key={`ellipsis-${i}`}
                  className="px-2 py-1 text-sm text-gray-400"
                >
                  ...
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => {
                    if (isExternalPagination) pagination?.onPageChange(p);
                    else setPage(p);
                  }}
                  className={`rounded-md px-3 py-1 text-sm transition-colors ${
                    p === safePage
                      ? "bg-indigo-600 text-white"
                      : "border border-gray-300 text-gray-600 hover:bg-slate-100"
                  }`}
                >
                  {p}
                </button>
              )
            )}
            <button
              onClick={() => {
                if (isExternalPagination) pagination?.onPageChange(currentPage + 1);
                else setPage((p) => Math.min(totalPages, p + 1));
              }}
              disabled={safePage === totalPages}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin_DataTable;