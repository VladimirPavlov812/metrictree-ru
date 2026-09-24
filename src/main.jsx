import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import PaymentTerms from "./PaymentTerms.jsx";
import ResetPassword from "./ResetPassword.jsx";

const path = window.location.pathname;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {path === "/payment-terms" ? (
      <PaymentTerms />
    ) : path === "/reset-password" ? (
      <ResetPassword />
    ) : (
      <App />
    )}
  </StrictMode>
);