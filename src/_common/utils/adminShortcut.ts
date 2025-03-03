import { useEffect } from "react";

export const useAdminShortcut = (callback: () => void) => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "z") {
      callback();
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, { passive: true });
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
};
