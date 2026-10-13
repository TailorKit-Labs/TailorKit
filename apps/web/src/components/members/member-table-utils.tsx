import { flexRender } from "@tanstack/react-table";
import type { Header, RowData } from "@tanstack/react-table";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import type { dataTableFeatures } from "#lib/table";

export const renderSortableHeader = <TData extends RowData>(
  header: Header<typeof dataTableFeatures, TData>
) => {
  if (header.isPlaceholder) {
    return null;
  }

  if (!header.column.getCanSort()) {
    // oxlint-disable-next-line typescript/no-unsafe-return -- TypeScript accepts TanStack flexRender as ReactNode; the Go linter cannot represent this conditional library return type.
    return flexRender(header.column.columnDef.header, header.getContext());
  }

  const sort = header.column.getIsSorted();
  let sortIcon = null;
  if (sort === "asc") {
    sortIcon = (
      <ChevronUpIcon
        aria-hidden="true"
        className="size-4 shrink-0 opacity-80"
      />
    );
  }
  if (sort === "desc") {
    sortIcon = (
      <ChevronDownIcon
        aria-hidden="true"
        className="size-4 shrink-0 opacity-80"
      />
    );
  }
  return (
    <button
      className="flex h-full w-full cursor-pointer items-center justify-between gap-2 text-left select-none"
      onClick={header.column.getToggleSortingHandler()}
      type="button"
    >
      {flexRender(header.column.columnDef.header, header.getContext())}
      {sortIcon}
    </button>
  );
};

export const getRoleBadgeVariant = (
  role: string
): "info" | "warning" | "outline" => {
  if (role === "owner") {
    return "info";
  }
  if (role === "admin") {
    return "warning";
  }
  return "outline";
};
