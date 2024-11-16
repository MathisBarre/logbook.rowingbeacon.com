import { SessionLogs } from "./components/SessionLogs";
import { IncidentLogs } from "./components/IncidentLogs";

interface LogbookProps {
  goBack: () => void;
}

export const Logbook = ({ goBack }: LogbookProps) => {
  return (
    <>
      <IncidentLogs />

      <SessionLogs goBack={goBack} />
    </>
  );
};
