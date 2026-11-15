import React from "react";
import ReactDOM from "react-dom/client";

import { ErrorBoundary } from "@/components/error/error-boundary";
import { ThemeProvider } from "@/providers/theme-provider";
import { LanguageProvider } from "@/providers/language-provider";
import { CurrencyProvider } from "@/providers/currency-provider";
import { LicenseProvider } from "@/providers/license-provider";
import LicenseGate from "@/components/license/license-gate";
import { AuthProvider } from "@/providers/auth-provider";
import AuthGate from "@/components/auth/auth-gate";
import AppRouter from "@/router";
import ToastViewport from "@/components/toast/toast-viewport";
import ConfirmDialog from "@/components/confirm/confirm-dialog";

import "./styles/app.css";
import "./styles/layout.css";
import "./styles/themes.css";
import "./styles/atelier.css";
import "./styles/search.css";
import "./styles/rtl.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <LanguageProvider>
          <CurrencyProvider>
            <LicenseProvider>
              <LicenseGate>
                <AuthProvider>
                  <AuthGate>
                    <AppRouter />
                  </AuthGate>
                </AuthProvider>
                <ConfirmDialog />
                <ToastViewport />
              </LicenseGate>
            </LicenseProvider>
          </CurrencyProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
