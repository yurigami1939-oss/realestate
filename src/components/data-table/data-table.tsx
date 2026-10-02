"use client";

import {
  createColumnHelper,
  type TableOptions,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Server-paginated tables (CLAUDE.md §8): the page renders one page of rows; paging, sorting
 * and filters live in the URL. TanStack Table only defines and renders the columns.
 */
export const dataTableFeatures = tableFeatures({});
export type DataTableFeatures = typeof dataTableFeatures;

export const dataTableColumns = <TData extends { id: string }>() =>
  createColumnHelper<DataTableFeatures, TData>();

export function DataTable<TData extends { id: string }>({
  columns,
  data,
  empty,
  testId,
}: {
  columns: TableOptions<DataTableFeatures, TData>["columns"];
  data: TData[];
  empty: string;
  testId?: string;
}) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId: (row) => row.id,
  });

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table data-testid={testId}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={table.getAllLeafColumns().length}
                className="py-10 text-center text-muted-foreground"
              >
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
