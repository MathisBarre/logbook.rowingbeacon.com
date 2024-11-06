import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { MyQueryClientProvider } from "./_common/lib/tanstack-query";
import { Router } from "./Router";
import { Toaster } from "sonner";
import { WindowConfirm } from "./_common/components/WindowConfirm";
import { WindowPrompt } from "./_common/components/WindowPrompt";
import { WindowAlert } from "./_common/components/WindowAlert";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MyQueryClientProvider>
      <Router />
      <Toaster position="bottom-center" richColors closeButton />
      <WindowConfirm />
      <WindowPrompt />
      <WindowAlert />
    </MyQueryClientProvider>
  </React.StrictMode>
);
