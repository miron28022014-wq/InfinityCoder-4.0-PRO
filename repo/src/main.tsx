import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const el = document.getElementById("root");
if (!el) throw new Error("Не найден контейнер #root");

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>
);
