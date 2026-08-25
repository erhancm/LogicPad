import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

async function boot() {
  const root = ReactDOM.createRoot(document.getElementById("root")!);
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("printPreview")) {
    const { PrintPreviewDev } = await import("./printPreview");
    root.render(
      <React.StrictMode>
        <PrintPreviewDev />
      </React.StrictMode>,
    );
    return;
  }
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
