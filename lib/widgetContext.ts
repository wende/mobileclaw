import { createContext, useContext } from "react";

export interface WidgetContextValue {
  isDetached: boolean;
  noBorder: boolean;
  wsUrl: string | null;
  token?: string | null;
  demo?: boolean;
  transparentHostBackground?: boolean;
}

const WidgetContext = createContext<WidgetContextValue | null>(null);

export const WidgetContextProvider = WidgetContext.Provider;

export function useWidgetContext(): WidgetContextValue | null {
  return useContext(WidgetContext);
}
