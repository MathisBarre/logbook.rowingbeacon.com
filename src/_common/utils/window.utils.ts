import { isTauri } from "@tauri-apps/api/core";
import { alert } from "../components/WindowAlert";
import { confirm } from "../components/WindowConfirm";
import { prompt } from "../components/WindowPrompt";
import { getCurrentWindow } from "@tauri-apps/api/window";

function isDektop() {
  return isTauri();
}

export const windowConfirm = (message: string) => {
  return confirm({ message });
};

export const windowAlert = (message: string) => {
  return alert({ message });
};

export const windowPrompt = (message: string, defaultValue?: string) => {
  return prompt({ message, defaultValue });
};

export const closeApp = () => {
  if (isDektop()) {
    console.log("closing desktop window");
    // close app with tauri 2
    return getCurrentWindow().close();
  }

  console.log("closing web window");
  return window.close();
};
