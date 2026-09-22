import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import PaymentTerms from "./PaymentTerms.jsx";

const isPaymentTerms = window.location.pathname === "/payment-terms";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {isPaymentTerms ? <PaymentTerms /> : <App />}
  </StrictMode>
);