import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PARTII_MSG, bindPartiiSsoHost, partiiSsoSignOut } from "@/lib/arcade/partiiSsoHost";

type Handler = (e: MessageEvent) => void;

function installWindowMock() {
  const listeners = new Map<string, Set<Handler>>();
  const win = {
    addEventListener(type: string, fn: Handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Handler) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(e: { type: string; origin: string; data: unknown }) {
      for (const fn of listeners.get(e.type) ?? []) {
        fn(e as MessageEvent);
      }
      return true;
    },
  };
  vi.stubGlobal("window", win);
  return win;
}

describe("partiiSsoHost", () => {
  let win: ReturnType<typeof installWindowMock>;

  beforeEach(() => {
    win = installWindowMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers partii:auth on partii:ready", () => {
    const postMessage = vi.fn();
    const iframe = { contentWindow: { postMessage } } as unknown as HTMLIFrameElement;
    const unbind = bindPartiiSsoHost({
      iframe,
      gameOrigin: "https://game.example",
      getAccessToken: () => "tok-1",
    });

    win.dispatchEvent({
      type: "message",
      origin: "https://game.example",
      data: { type: "partii:ready" },
    });

    expect(postMessage).toHaveBeenCalledWith(
      { type: PARTII_MSG.auth, token: "tok-1" },
      "https://game.example",
    );
    unbind();
  });

  it("also accepts legacy arcadii:ready", () => {
    const postMessage = vi.fn();
    const iframe = { contentWindow: { postMessage } } as unknown as HTMLIFrameElement;
    const unbind = bindPartiiSsoHost({
      iframe,
      gameOrigin: "https://game.example",
      getAccessToken: () => "tok-2",
    });

    win.dispatchEvent({
      type: "message",
      origin: "https://game.example",
      data: { type: "arcadii:ready" },
    });

    expect(postMessage).toHaveBeenCalledWith(
      { type: "partii:auth", token: "tok-2" },
      "https://game.example",
    );
    unbind();
  });

  it("ignores wrong origin", () => {
    const postMessage = vi.fn();
    const iframe = { contentWindow: { postMessage } } as unknown as HTMLIFrameElement;
    const unbind = bindPartiiSsoHost({
      iframe,
      gameOrigin: "https://game.example",
      getAccessToken: () => "tok",
    });

    win.dispatchEvent({
      type: "message",
      origin: "https://evil.example",
      data: { type: "partii:ready" },
    });

    expect(postMessage).not.toHaveBeenCalled();
    unbind();
  });

  it("partiiSsoSignOut posts partii:signout", () => {
    const postMessage = vi.fn();
    const iframe = { contentWindow: { postMessage } } as unknown as HTMLIFrameElement;
    partiiSsoSignOut(iframe, "https://game.example");
    expect(postMessage).toHaveBeenCalledWith(
      { type: PARTII_MSG.signout },
      "https://game.example",
    );
  });
});
