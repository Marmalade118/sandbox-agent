import type { DesktopMouseButton } from "./types.ts";

const WS_READY_STATE_CONNECTING = 0;
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSED = 3;

export interface DesktopStreamReadyStatus {
  type: "ready";
  width: number;
  height: number;
}

export interface DesktopStreamErrorStatus {
  type: "error";
  message: string;
}

export type DesktopStreamStatusMessage = DesktopStreamReadyStatus | DesktopStreamErrorStatus;

export interface DesktopStreamConnectOptions {
  accessToken?: string;
  WebSocket?: typeof WebSocket;
  protocols?: string | string[];
}

type DesktopStreamClientFrame =
  | {
      type: "moveMouse";
      x: number;
      y: number;
    }
  | {
      type: "mouseDown" | "mouseUp";
      x?: number;
      y?: number;
      button?: DesktopMouseButton;
    }
  | {
      type: "scroll";
      x: number;
      y: number;
      deltaX?: number;
      deltaY?: number;
    }
  | {
      type: "keyDown" | "keyUp";
      key: string;
    }
  | {
      type: "close";
    };

export class DesktopStreamSession {
  readonly socket: WebSocket;
  readonly closed: Promise<void>;

  private readonly readyListeners = new Set<(status: DesktopStreamReadyStatus) => void>();
  private readonly frameListeners = new Set<(frame: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: DesktopStreamErrorStatus | Error) => void>();
  private readonly closeListeners = new Set<() => void>();

  private closeSignalSent = false;
  private closedResolve!: () => void;

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.binaryType = "arraybuffer";
    this.closed = new Promise<void>((resolve) => {
      this.closedResolve = resolve;
    });

    this.socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });
    this.socket.addEventListener("error", () => {
      this.emitError(new Error("Desktop stream websocket connection failed."));
    });
    this.socket.addEventListener("close", () => {
      this.closedResolve();
      for (const listener of this.closeListeners) {
        listener();
      }
    });
  }

  onReady(listener: (status: DesktopStreamReadyStatus) => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  onFrame(listener: (frame: Uint8Array) => void): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  onError(listener: (error: DesktopStreamErrorStatus | Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  moveMouse(x: number, y: number): void {
    this.sendFrame({ type: "moveMouse", x, y });
  }

  mouseDown(button?: DesktopMouseButton, x?: number, y?: number): void {
    this.sendFrame({ type: "mouseDown", button, x, y });
  }

  mouseUp(button?: DesktopMouseButton, x?: number, y?: number): void {
    this.sendFrame({ type: "mouseUp", button, x, y });
  }

  scroll(x: number, y: number, deltaX?: number, deltaY?: number): void {
    this.sendFrame({ type: "scroll", x, y, deltaX, deltaY });
  }

  keyDown(key: string): void {
    this.sendFrame({ type: "keyDown", key });
  }

  keyUp(key: string): void {
    this.sendFrame({ type: "keyUp", key });
  }

  close(): void {
    if (this.socket.readyState === WS_READY_STATE_CONNECTING) {
      this.socket.addEventListener(
        "open",
        () => {
          this.close();
        },
        { once: true },
      );
      return;
    }

    if (this.socket.readyState === WS_READY_STATE_OPEN) {
      if (!this.closeSignalSent) {
        this.closeSignalSent = true;
        this.sendFrame({ type: "close" });
      }
      this.socket.close();
      return;
    }

    if (this.socket.readyState !== WS_READY_STATE_CLOSED) {
      this.socket.close();
    }
  }

  private async handleMessage(data: unknown): Promise<void> {
    try {
      if (typeof data === "string") {
        const frame = parseStatusFrame(data);
        if (!frame) {
          this.emitError(new Error("Received invalid desktop stream control frame."));
          return;
        }

        if (frame.type === "ready") {
          for (const listener of this.readyListeners) {
            listener(frame);
          }
          return;
        }

        this.emitError(frame);
        return;
      }

      const bytes = await decodeBinaryFrame(data);
      for (const listener of this.frameListeners) {
        listener(bytes);
      }
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private sendFrame(frame: DesktopStreamClientFrame): void {
    if (this.socket.readyState !== WS_READY_STATE_OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(frame));
  }

  private emitError(error: DesktopStreamErrorStatus | Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}

function parseStatusFrame(payload: string): DesktopStreamStatusMessage | null {
  const value = JSON.parse(payload) as Record<string, unknown>;
  if (value.type === "ready" && typeof value.width === "number" && typeof value.height === "number") {
    return {
      type: "ready",
      width: value.width,
      height: value.height,
    };
  }
  if (value.type === "error" && typeof value.message === "string") {
    return {
      type: "error",
      message: value.message,
    };
  }
  return null;
}

async function decodeBinaryFrame(data: unknown): Promise<Uint8Array> {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  throw new Error("Unsupported desktop stream binary frame type.");
}
