import {
  AgeCategoryEnum,
  SeriousnessCategoryEnum,
} from "../../_common/store/boatLevelConfig.business";
import { BoatTypeEnum, getBoatTypeLabel } from "../../_common/types/boat.type";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";
import { SortingState } from "@tanstack/react-table";
import { generateBoats } from "../utils/generateBoats";
import { sortBoatsByType } from "../../_common/business/boat.rules";

export interface BoatInTable {
  id: string;
  name: string;
  isInMaintenance: boolean;
  type: BoatTypeEnum;
  minimumRowerType: SeriousnessCategoryEnum;
  minimumRowerCategory: AgeCategoryEnum;
}

const boats: BoatInTable[] = generateBoats(100);

const columnHelper = createColumnHelper<BoatInTable>();

const columns = [
  columnHelper.accessor("name", {
    header: "Nom",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("type", {
    header: "Type",
    cell: (info) => getBoatTypeLabel(info.getValue()),
    sortingFn: (rowA, rowB, columnId) => {
      return sortBoatsByType(rowA.getValue(columnId), rowB.getValue(columnId));
    },
    enableGrouping: true,
  }),
  columnHelper.accessor("minimumRowerType", {
    header: "Niveau minimum",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("minimumRowerCategory", {
    header: "Catégorie minimum",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("isInMaintenance", {
    header: "En maintenance",
    cell: (info) => (info.getValue() ? "Oui" : "Non"),
  }),
];
export const BoatsTable = () => {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "type", desc: false },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data: boats,
    columns,
    state: {
      sorting,
      globalFilter,
      grouping: ["type"],
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="p-4">
      <div className="mb-4">
        <input
          type="text"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Rechercher..."
          className="p-2 border rounded"
        />
      </div>
      <table className="min-w-full border-collapse border">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="border p-2 bg-gray-100 cursor-pointer"
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )}
                  {{ asc: " ↑", desc: " ↓" }[
                    header.column.getIsSorted() as string
                  ] ?? ""}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="border p-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
