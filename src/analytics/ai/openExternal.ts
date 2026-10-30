import { isTauri } from "@tauri-apps/api/core";

/** Opens an https link in the system browser (shell open in the app). */
export const openExternal = async (url: string): Promise<void> => {
  if (!/^https:\/\//.test(url)) {
    return;
  }
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};
