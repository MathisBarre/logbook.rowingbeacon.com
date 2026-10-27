import { create } from "zustand";
import { enqueueWrite } from "../database/writeQueue";
import { insertIncident } from "../database/repositories/club.repository";
import { ClubIncident } from "../database/repositories/club.types";

type ZustandIncident = ClubIncident;

interface ZustandIncidentStore {
  incidents: ZustandIncident[];
  hydrate: (incidents: ZustandIncident[]) => void;
  addIncident: (incident: ZustandIncident) => void;
  getIncidents: () => ZustandIncident[];
  getIncident: (id: string) => ZustandIncident | undefined;
  getIncidentsByBoatId: (boatId: string) => ZustandIncident[];
  /** The outing was deleted: its incidents stay, without it. */
  detachFromSession: (sessionId: string) => void;
  reset: () => void;
}

const useIncidentStore = create<ZustandIncidentStore>()((set, get) => ({
  incidents: [],
  hydrate: (incidents) => {
    set({ incidents });
  },
  addIncident: (incident: ZustandIncident) => {
    set((state) => ({
      incidents: [incident, ...state.incidents],
    }));
    void enqueueWrite("incident", (db) => insertIncident(db, incident));
  },
  getIncidents: () => {
    return [...get().incidents].sort((a, b) => {
      return new Date(b.datetime).getTime() - new Date(a.datetime).getTime();
    });
  },
  getIncident: (id: string) => {
    return get().incidents.find((incident) => incident.id === id);
  },
  getIncidentsByBoatId: (boatId: string) => {
    return get().incidents.filter((incident) => incident.boatId === boatId);
  },
  detachFromSession: (sessionId: string) => {
    set((state) => ({
      incidents: state.incidents.map((incident) =>
        incident.sessionId === sessionId
          ? { ...incident, sessionId: "" }
          : incident
      ),
    }));
  },
  reset: () => {
    set({ incidents: [] });
  },
}));

export default useIncidentStore;
