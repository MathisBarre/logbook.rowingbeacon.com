import { create } from "zustand";

interface ZustandNavigation {
  page: "boathouse" | "logbook" | "parameters";
}

interface ZustandNavigationStore {
  navigation: ZustandNavigation;
  setPage: (page: "boathouse" | "logbook" | "parameters") => void;
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
