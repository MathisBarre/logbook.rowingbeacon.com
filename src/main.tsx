import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { Router } from "./Router";
import { Toaster } from "sonner";
import { WindowConfirm } from "./_common/components/WindowConfirm";
import { WindowPrompt } from "./_common/components/WindowPrompt";
import { WindowAlert } from "./_common/components/WindowAlert";
import "./_common/i18n/config";
import { I18nextProvider } from "react-i18next";
import i18n from "./_common/i18n/config";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <Router />
      <Toaster position="bottom-center" richColors closeButton />
      <WindowConfirm />
      <WindowPrompt />
      <WindowAlert />
    </I18nextProvider>
  </React.StrictMode>
);
