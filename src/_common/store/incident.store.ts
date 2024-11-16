import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ZustandIncident {
  id: string;
  message: string;
  sessionId: string;
  datetime: Date;
}

interface ZustandIncidentStore {
  incidents: ZustandIncident[];
  addIncident: (incident: ZustandIncident) => void;
  getIncidents: () => ZustandIncident[];
}

const useIncidentStore = create(
  persist<ZustandIncidentStore>(
    (set, get) => ({
      incidents: [],
      addIncident: (incident: ZustandIncident) => {
        set((state) => ({
          incidents: [incident, ...state.incidents],
        }));
      },
      getIncidents: () => {
        return get().incidents.sort(
          (a, b) => b.datetime.getTime() - a.datetime.getTime()
        );
      },
    }),
    {
      name: "incidents",
    }
  )
);

export default useIncidentStore;
