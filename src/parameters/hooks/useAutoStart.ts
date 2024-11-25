import { useEffect, useState } from "react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";

export const useAutoStart = () => {
  const [autoStartState, setAutoStartState] = useState<
    "pending" | "activated" | "not-activated"
  >("pending");

  useEffect(() => {
    (async () => {
      const _isEnabled = await isEnabled();

      setAutoStartState(_isEnabled ? "activated" : "not-activated");
    })();
  });

  return {
    autoStartState,
    async enableAutoStart() {
      await enable();
      setAutoStartState("activated");
    },
    async disableAutoStart() {
      await disable();
      setAutoStartState("not-activated");
    },
  };
};
