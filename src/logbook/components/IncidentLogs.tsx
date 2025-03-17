import { SirenIcon } from "lucide-react";
import { IncidentLogsTable } from "./IncidentLogsTable";

export const IncidentLogs = () => {
  return (
    <div className="flex-1 shadow-md bg-white flex flex-col absolute inset-0 left-1/2 ml-[.125rem] rounded overflow-hidden">
      <div className="bg-border p-2 bg-gradient-to-r from-steel-blue-800 to-steel-blue-700 text-white flex justify-between h-12 min-h-12 max-h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center">
          <SirenIcon /> Historique des incidents
        </h1>
      </div>

      <IncidentLogsTable />

      {/* DECORATIONS */}
      <div className="absolute l-0 t-0 b-0 w-2 h-full bg-steel-blue-800 z-10"></div>

      <div className="absolute left-2 top-12 w-2 h-2 z-10">
        <svg
          width="4"
          height="4"
          viewBox="0 0 4 4"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0 4C0 2 2 0 4 0H0V4Z" fill="#22426A" />
        </svg>
      </div>

      <div className="absolute left-[8px] top-12 w-2 h-2 z-10">
        <svg
          width="4"
          height="4"
          viewBox="0 0 4 4"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0 4C0 2 2 0 4 0H0V4Z" fill="#22426A" />
        </svg>
      </div>
      {/* DECORATIONS */}
    </div>
  );
};
