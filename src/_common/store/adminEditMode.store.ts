import { create } from "zustand";

export const adminEditModeStore = create<{
  isInAdminEditMode: boolean;
  toggleAdminEditMode: () => void;
  stopAdminEditMode: () => void;
  startAdminEditMode: () => void;
}>()((set) => ({
  isInAdminEditMode: false,

  toggleAdminEditMode: () => {
    set((state) => {
      return {
        isInAdminEditMode: !state.isInAdminEditMode,
      };
    });
  },

  stopAdminEditMode: () => {
    set({ isInAdminEditMode: false });
  },

  startAdminEditMode: () => {
    set({ isInAdminEditMode: true });
  },
}));
