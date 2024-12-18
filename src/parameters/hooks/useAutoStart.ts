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
    })().catch(console.error);
  });

  return {
    autoStartState,
    enableAutoStart: async () => {
      await enable();
      setAutoStartState("activated");
    },
    disableAutoStart: async () => {
      await disable();
      setAutoStartState("not-activated");
    },
  };
};
