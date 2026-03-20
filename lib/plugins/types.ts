import type { ReactNode } from "react";

import type { PluginAction, PluginContentPart, PluginState } from "@/types/chat";

export type PluginWidth = "bubble" | "chat";

export type PluginParseResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: string;
    };

export interface PluginViewProps<TData = unknown> {
  messageId: string;
  part: PluginContentPart;
  partId: string;
  state: PluginState;
  data: TData;
  isStreaming: boolean;
  invokeAction: (action: PluginAction, input?: Record<string, unknown>) => Promise<void>;
  addInputAttachment?: (kind: string, data: unknown) => void;
}

export interface MobileClawPlugin<TData = unknown> {
  type: string;
  schemaVersion?: number;
  width?: PluginWidth;
  parse: (raw: unknown) => PluginParseResult<TData>;
  render: (props: PluginViewProps<TData>) => ReactNode;
}

// The registry stores heterogeneous plugin definitions with different payload types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMobileClawPlugin = MobileClawPlugin<any>;

export interface PluginActionInvocation {
  messageId: string;
  part: PluginContentPart;
  action: PluginAction;
  input?: Record<string, unknown>;
}

export type PluginActionHandler = (invocation: PluginActionInvocation) => Promise<void>;
