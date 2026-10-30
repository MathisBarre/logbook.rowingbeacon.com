import { create } from "zustand";
import {
  BoatReservation,
  DEFAULT_RESERVATION_LOOKAHEAD_MINUTES,
} from "../business/reservation.rules";
import { enqueueWrite } from "../database/writeQueue";
import { saveSetting } from "../database/repositories/club.repository";
import {
  deleteReservation,
  saveReservation,
} from "../database/repositories/reservation.repository";

export const SETTING_RESERVATION_LOOKAHEAD = "reservations.lookaheadMinutes";

interface ReservationStoreState {
  reservations: BoatReservation[];
  /** Minutes before a reservation during which the boathouse shows the boat as reserved. */
  lookaheadMinutes: number;
  hydrate: (
    reservations: BoatReservation[],
    settings: Record<string, unknown>
  ) => void;
  setLookaheadMinutes: (minutes: number) => void;
  /** Adds the reservation, or replaces the one with the same id. */
  save: (reservation: BoatReservation) => void;
  remove: (id: string) => void;
  reset: () => void;
}

export const useReservationStore = create<ReservationStoreState>()((set) => ({
  reservations: [],
  lookaheadMinutes: DEFAULT_RESERVATION_LOOKAHEAD_MINUTES,
  hydrate(reservations, settings) {
    const lookahead = settings[SETTING_RESERVATION_LOOKAHEAD];
    set({
      reservations,
      lookaheadMinutes:
        typeof lookahead === "number" && lookahead >= 0
          ? lookahead
          : DEFAULT_RESERVATION_LOOKAHEAD_MINUTES,
    });
  },
  setLookaheadMinutes(minutes) {
    set({ lookaheadMinutes: minutes });
    void enqueueWrite(`setting ${SETTING_RESERVATION_LOOKAHEAD}`, (db) =>
      saveSetting(db, SETTING_RESERVATION_LOOKAHEAD, minutes)
    );
  },
  save(reservation) {
    set((state) => ({
      reservations: [
        ...state.reservations.filter((item) => item.id !== reservation.id),
        reservation,
      ],
    }));
    void enqueueWrite("reservation", (db) => saveReservation(db, reservation));
  },
  remove(id) {
    set((state) => ({
      reservations: state.reservations.filter((item) => item.id !== id),
    }));
    void enqueueWrite("reservation", (db) => deleteReservation(db, id));
  },
  reset() {
    set({
      reservations: [],
      lookaheadMinutes: DEFAULT_RESERVATION_LOOKAHEAD_MINUTES,
    });
  },
}));
