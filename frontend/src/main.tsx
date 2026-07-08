import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import { queryClient } from "./lib/queries";
import "./index.css";

// The app's theme is class-driven (`.light` on <html>, toggled by Shell's
// useTheme hook), not media-query-driven — so sonner's `theme` prop needs to
// track that class rather than defaulting to light.
function ThemedToaster() {
  const [light, setLight] = useState(() => document.documentElement.classList.contains("light"));
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setLight(root.classList.contains("light")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return <Toaster richColors position="bottom-right" theme={light ? "light" : "dark"} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ThemedToaster />
    </QueryClientProvider>
  </React.StrictMode>,
);
