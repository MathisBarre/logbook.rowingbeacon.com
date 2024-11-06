import { alert } from "../components/WindowAlert";
import { confirm } from "../components/WindowConfirm";
import { prompt } from "../components/WindowPrompt";

export const windowConfirm = (message: string) => {
  return confirm({ message });
};

export const windowAlert = (message: string) => {
  return alert({ message });
};

export const windowPrompt = (message: string, defaultValue?: string) => {
  return prompt({ message, defaultValue });
};