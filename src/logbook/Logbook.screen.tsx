import { SessionLogs } from "./components/SessionLogs";
import { IncidentLogs } from "./components/IncidentLogs";

export const LogbookScreen = () => {
  return (
    <>
      <SessionLogs />
      <IncidentLogs />
    </>
  );
};
