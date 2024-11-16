import { create } from "zustand";

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

const useIncidentStore = create<ZustandIncidentStore>((set, get) => ({
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
}));

export default useIncidentStore;
