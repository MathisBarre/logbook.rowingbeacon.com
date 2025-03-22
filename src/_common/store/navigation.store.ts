import { create } from "zustand";

export type AdminPage = "boathouse" | "logbook" | "parameters" | "stats";

interface ZustandNavigation {
  page: AdminPage;
}

interface ZustandNavigationStore {
  navigation: ZustandNavigation;
  setPage: (page: AdminPage) => void;
}

const useNavigationStore = create<ZustandNavigationStore>((set) => ({
  navigation: {
    page: "boathouse",
  },
  setPage: (page) => {
    set((state) => ({
      navigation: {
        ...state.navigation,
        page,
      },
    }));
  },
}));

export default useNavigationStore;
