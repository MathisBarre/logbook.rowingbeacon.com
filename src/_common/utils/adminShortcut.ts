import { useEffect, useRef } from "react";

export const useAdminShortcut = (callback: () => void) => {
  // The listener is set once; it calls the latest callback.
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // In a text field, Ctrl+Z undoes the typing.
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      ) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "z") {
        latest.current();
      }
    };
    document.addEventListener("keydown", handleKeyDown, { passive: true });
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
};
