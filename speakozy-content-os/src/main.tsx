import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OsApp } from "./os/OsApp";
import "./os/os.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><OsApp /></StrictMode>
);
