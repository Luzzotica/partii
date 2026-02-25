/**
 * Parses ServerMessage (protobuf) and dispatches to registered handlers.
 */

import { fromBinary } from "@bufbuild/protobuf";
import { ServerMessageSchema } from "../proto-gen/gyrii_pb";

export type MessageHandler = (msg: { case: string; value: unknown }) => void;

const handlers: MessageHandler[] = [];

export function register(handler: MessageHandler): () => void {
  handlers.push(handler);
  return () => {
    const i = handlers.indexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

export function dispatch(data: Uint8Array): void {
  try {
    const msg = fromBinary(ServerMessageSchema, data);
    if (!msg.message) return;
    const m = msg.message;
    const caseName = m.case ?? "unknown";
    const value = "value" in m ? m.value : undefined;
    for (const h of handlers) {
      try {
        h({ case: caseName, value });
      } catch (e) {
        console.warn("Handler error for", caseName, e);
      }
    }
  } catch (e) {
    console.warn("Failed to parse server message", e);
  }
}
