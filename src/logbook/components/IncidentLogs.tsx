import { SirenIcon } from "lucide-react";
import { IncidentLogsTable } from "./IncidentLogsTable";

export const IncidentLogs = () => {
  return (
    <div className="flex-1 shadow-md bg-white flex flex-col absolute inset-1 left-1/2 ml-[.125rem] rounded overflow-hidden">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-14">
        <div className="flex items-center">
          <h1 className="text-base ml-2 flex gap-2 items-center">
            <SirenIcon /> Historique des incidents
          </h1>
        </div>
      </div>

      <IncidentLogsTable />
    </div>
  );
};
