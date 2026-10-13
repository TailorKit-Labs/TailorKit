import { flexRender } from "@tanstack/react-table";
import type { Header, RowData } from "@tanstack/react-table";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import type { dataTableFeatures } from "#lib/table";

export function renderSortableHeader<TData extends RowData>(
  header: Header<typeof dataTableFeatures, TData, unknown>
) {
  if (header.isPlaceholder) {
    return null;
  }

  if (!header.column.getCanSort()) {
    return flexRender(header.column.columnDef.header, header.getContext());
  }

  return (
    <button
      className="flex h-full w-full cursor-pointer items-center justify-between gap-2 text-left select-none"
      onClick={header.column.getToggleSortingHandler()}
      type="button"
    >
      {flexRender(header.column.columnDef.header, header.getContext())}
      {{
        asc: (
          <ChevronUpIcon
            aria-hidden="true"
            className="size-4 shrink-0 opacity-80"
          />
        ),
        desc: (
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 shrink-0 opacity-80"
          />
        ),
      }[header.column.getIsSorted() as string] ?? null}
    </button>
  );
}

export function getRoleBadgeVariant(
  role: string
): "info" | "warning" | "outline" {
  if (role === "owner") {
    return "info";
  }
  if (role === "admin") {
    return "warning";
  }
  return "outline";
}
