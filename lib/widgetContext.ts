import { createContext, useContext } from "react";

export interface WidgetContextValue {
  isDetached: boolean;
  noBorder: boolean;
  wsUrl: string | null;
  token?: string | null;
  demo?: boolean;
  transparentHostBackground?: boolean;
  onSessionsChange?: (sessions: import("@mc/types/chat").SessionInfo[], currentKey: string, loading: boolean) => void;
  /** Called when the gateway rejects a connect with DEVICE_AUTH_SIGNATURE_INVALID.
   *  Return a fresh gateway auth token (or null). */
  onTokenRefresh?: () => Promise<string | null>;
}

const WidgetContext = createContext<WidgetContextValue | null>(null);

export const WidgetContextProvider = WidgetContext.Provider;

export function useWidgetContext(): WidgetContextValue | null {
  return useContext(WidgetContext);
}
