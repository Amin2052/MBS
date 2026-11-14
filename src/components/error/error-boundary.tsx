import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from "react";
import { logger } from "@/utils/logger";
import { translate } from "@/i18n/translator";
import { LANGUAGE_STORAGE_KEY, type LanguageCode } from "@/i18n";

interface ErrorBoundaryState { hasError: boolean; }

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false };
  public static getDerivedStateFromError(): ErrorBoundaryState { return { hasError: true }; }
  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error(error.message);
    logger.error(errorInfo.componentStack ?? "Unknown component stack");
  }
  public render(): ReactNode {
    if (this.state.hasError) {
      // Reads the persisted language preference directly rather than via
      // useLanguage() -- this is a class component (React error boundaries
      // must be classes), so hooks aren't available here.
      const language = (localStorage.getItem(LANGUAGE_STORAGE_KEY) as LanguageCode | null) ?? "en";
      return <main className="app"><h1>{translate(language, "errorBoundary.somethingWentWrong")}</h1></main>;
    }
    return this.props.children;
  }
}
