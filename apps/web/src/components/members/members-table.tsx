import { Avatar, AvatarFallback } from "@tailorkit/ui/avatar";
import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import { CardFrame } from "@tailorkit/ui/card";
import { DateAgo } from "@tailorkit/ui/date";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tailorkit/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tailorkit/ui/table";
import { flexRender, useTable } from "@tanstack/react-table";
import type {
  CellContext,
  ColumnDef,
  SortingState,
} from "@tanstack/react-table";
import { MoreHorizontalIcon, TrashIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { dataTableFeatures } from "#lib/table";

import {
  getRoleBadgeVariant,
  renderSortableHeader,
} from "./member-table-utils";

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date | string;
  userId: string;
  isCurrentUser: boolean;
  isOwner: boolean;
}

interface MemberColumnsOptions {
  canManage: boolean;
  onRemove: (memberId: string) => void;
  removePending: boolean;
}

const createMemberColumns = ({
  canManage,
  onRemove,
  removePending,
}: MemberColumnsOptions): ColumnDef<typeof dataTableFeatures, MemberRow>[] => [
  {
    accessorKey: "name",
    cell: ({
      row,
    }: CellContext<typeof dataTableFeatures, MemberRow, unknown>) => {
      const initials = row.original.name
        .split(" ")
        .map((word: string) => word[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
      return (
        <div className="flex items-center gap-3">
          <Avatar className="size-7">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm leading-tight font-medium">
              {row.original.name}
              {row.original.isCurrentUser && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  (you)
                </span>
              )}
            </p>
            <p className="truncate text-xs leading-tight text-muted-foreground">
              {row.original.email}
            </p>
          </div>
        </div>
      );
    },
    header: "Member",
    size: 280,
  },
  {
    accessorKey: "role",
    cell: ({
      row,
    }: CellContext<typeof dataTableFeatures, MemberRow, unknown>) => (
      <Badge variant={getRoleBadgeVariant(row.original.role)} size="lg">
        {row.original.role.charAt(0).toUpperCase() + row.original.role.slice(1)}
      </Badge>
    ),
    header: "Role",
    size: 110,
  },
  {
    accessorKey: "createdAt",
    cell: ({
      row,
    }: CellContext<typeof dataTableFeatures, MemberRow, unknown>) => (
      <DateAgo date={row.original.createdAt} />
    ),
    header: "Last Active",
    size: 140,
    sortFn: "datetime",
  },
  {
    cell: ({
      row,
    }: CellContext<typeof dataTableFeatures, MemberRow, unknown>) => (
      <div className="flex items-center justify-end gap-1">
        {canManage && !row.original.isCurrentUser && !row.original.isOwner && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="icon-sm" variant="ghost" />}
            >
              <MoreHorizontalIcon className="size-4" />
              <span className="sr-only">Open member actions</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                disabled={removePending}
                variant="destructive"
                onClick={() => onRemove(row.original.id)}
              >
                <TrashIcon />
                Remove member
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    ),
    enableSorting: false,
    header: () => null,
    id: "actions",
    size: 80,
  },
];

export const MembersTable = ({
  members,
  canManage,
  onRemove,
  removePending,
  search,
}: {
  members: MemberRow[];
  canManage: boolean;
  onRemove: (memberId: string) => void;
  removePending: boolean;
  search: string;
}) => {
  const [sorting, setSorting] = useState<SortingState>([
    { desc: false, id: "name" },
  ]);

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return members;
    }

    return members.filter(
      (member) =>
        member.name.toLowerCase().includes(normalizedSearch) ||
        member.email.toLowerCase().includes(normalizedSearch)
    );
  }, [members, search]);

  const columns = useMemo<ColumnDef<typeof dataTableFeatures, MemberRow>[]>(
    () => createMemberColumns({ canManage, onRemove, removePending }),
    [canManage, onRemove, removePending]
  );

  const table = useTable({
    columns,
    data: filtered,
    enableSortingRemoval: false,
    features: dataTableFeatures,
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <CardFrame className="w-full">
      <Table variant="card" className="table-fixed">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const columnSize = header.column.getSize();
                return (
                  <TableHead
                    key={header.id}
                    className="w-[var(--column-width)]"
                    style={{
                      "--column-width": columnSize ? `${columnSize}px` : "auto",
                    }}
                  >
                    {renderSortableHeader(header)}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell className="h-24 text-center" colSpan={columns.length}>
                No members found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </CardFrame>
  );
};
