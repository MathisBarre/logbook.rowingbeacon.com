import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ZustandIncident {
  id: string;
  boatId: string;
  message: string;
  sessionId: string;
  datetime: string;
}

interface ZustandIncidentStore {
  incidents: ZustandIncident[];
  addIncident: (incident: ZustandIncident) => void;
  getIncidents: () => ZustandIncident[];
  getIncident: (id: string) => ZustandIncident | undefined;
  getIncidentsByBoatId: (boatId: string) => ZustandIncident[];
  reset: () => void;
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
        return get().incidents.sort((a, b) => {
          return (
            new Date(b.datetime).getTime() - new Date(a.datetime).getTime()
          );
        });
      },
      getIncident: (id: string) => {
        return get().incidents.find((incident) => incident.id === id);
      },
      getIncidentsByBoatId: (boatId: string) => {
        return get().incidents.filter((incident) => incident.boatId === boatId);
      },
      reset: () => {
        set({ incidents: [] });
      },
    }),
    {
      name: "incidents",
    }
  )
);

export default useIncidentStore;
