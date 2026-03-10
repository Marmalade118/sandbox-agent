"use client";

import type { CSSProperties, MouseEvent, WheelEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type {
  DesktopMouseButton,
  DesktopStreamErrorStatus,
  DesktopStreamReadyStatus,
  SandboxAgent,
} from "sandbox-agent";

type ConnectionState = "connecting" | "ready" | "closed" | "error";

export type DesktopViewerClient = Pick<
  SandboxAgent,
  "startDesktopStream" | "stopDesktopStream" | "connectDesktopStream"
>;

export interface DesktopViewerProps {
  client: DesktopViewerClient;
  className?: string;
  style?: CSSProperties;
  imageStyle?: CSSProperties;
  height?: number | string;
  onConnect?: (status: DesktopStreamReadyStatus) => void;
  onDisconnect?: () => void;
  onError?: (error: DesktopStreamErrorStatus | Error) => void;
}

const shellStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  border: "1px solid rgba(15, 23, 42, 0.14)",
  borderRadius: 14,
  background:
    "linear-gradient(180deg, rgba(248, 250, 252, 0.96) 0%, rgba(226, 232, 240, 0.92) 100%)",
  boxShadow: "0 20px 40px rgba(15, 23, 42, 0.08)",
};

const statusBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "10px 14px",
  borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
  background: "rgba(255, 255, 255, 0.78)",
  color: "#0f172a",
  fontSize: 12,
  lineHeight: 1.4,
};

const viewportStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  background:
    "radial-gradient(circle at top, rgba(14, 165, 233, 0.18), transparent 45%), linear-gradient(180deg, #0f172a 0%, #111827 100%)",
};

const imageBaseStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "contain",
  userSelect: "none",
};

const hintStyle: CSSProperties = {
  opacity: 0.66,
};

const getStatusColor = (state: ConnectionState): string => {
  switch (state) {
    case "ready":
      return "#15803d";
    case "error":
      return "#b91c1c";
    case "closed":
      return "#b45309";
    default:
      return "#475569";
  }
};

export const DesktopViewer = ({
  client,
  className,
  style,
  imageStyle,
  height = 480,
  onConnect,
  onDisconnect,
  onError,
}: DesktopViewerProps) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<ReturnType<DesktopViewerClient["connectDesktopStream"]> | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [statusMessage, setStatusMessage] = useState("Starting desktop stream...");
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let lastObjectUrl: string | null = null;
    let session: ReturnType<DesktopViewerClient["connectDesktopStream"]> | null = null;

    setConnectionState("connecting");
    setStatusMessage("Starting desktop stream...");
    setResolution(null);

    const connect = async () => {
      try {
        await client.startDesktopStream();
        if (cancelled) {
          return;
        }

        session = client.connectDesktopStream();
        sessionRef.current = session;
        session.onReady((status) => {
          if (cancelled) {
            return;
          }
          setConnectionState("ready");
          setStatusMessage("Desktop stream connected.");
          setResolution({ width: status.width, height: status.height });
          onConnect?.(status);
        });
        session.onFrame((frame) => {
          if (cancelled) {
            return;
          }
          const nextUrl = URL.createObjectURL(
            new Blob([frame.slice().buffer], { type: "image/jpeg" }),
          );
          setFrameUrl((current) => {
            if (current) {
              URL.revokeObjectURL(current);
            }
            return nextUrl;
          });
          if (lastObjectUrl) {
            URL.revokeObjectURL(lastObjectUrl);
          }
          lastObjectUrl = nextUrl;
        });
        session.onError((error) => {
          if (cancelled) {
            return;
          }
          setConnectionState("error");
          setStatusMessage(error instanceof Error ? error.message : error.message);
          onError?.(error);
        });
        session.onClose(() => {
          if (cancelled) {
            return;
          }
          setConnectionState((current) => (current === "error" ? current : "closed"));
          setStatusMessage((current) =>
            current === "Desktop stream connected." ? "Desktop stream disconnected." : current,
          );
          onDisconnect?.();
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        const nextError = error instanceof Error ? error : new Error("Failed to initialize desktop stream.");
        setConnectionState("error");
        setStatusMessage(nextError.message);
        onError?.(nextError);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      session?.close();
      sessionRef.current = null;
      void client.stopDesktopStream().catch(() => undefined);
      setFrameUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return null;
      });
      if (lastObjectUrl) {
        URL.revokeObjectURL(lastObjectUrl);
      }
    };
  }, [client, onConnect, onDisconnect, onError]);

  const scalePoint = (clientX: number, clientY: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !resolution) {
      return null;
    }
    const rect = wrapper.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    const x = Math.max(0, Math.min(resolution.width, ((clientX - rect.left) / rect.width) * resolution.width));
    const y = Math.max(0, Math.min(resolution.height, ((clientY - rect.top) / rect.height) * resolution.height));
    return {
      x: Math.round(x),
      y: Math.round(y),
    };
  };

  const buttonFromMouseEvent = (event: MouseEvent<HTMLDivElement>): DesktopMouseButton => {
    switch (event.button) {
      case 1:
        return "middle";
      case 2:
        return "right";
      default:
        return "left";
    }
  };

  const withSession = (
    callback: (session: NonNullable<ReturnType<DesktopViewerClient["connectDesktopStream"]>>) => void,
  ) => {
    const session = sessionRef.current;
    if (session) {
      callback(session);
    }
  };

  return (
    <div className={className} style={{ ...shellStyle, ...style }}>
      <div style={statusBarStyle}>
        <span style={{ color: getStatusColor(connectionState) }}>{statusMessage}</span>
        <span style={hintStyle}>
          {resolution ? `${resolution.width}×${resolution.height}` : "Awaiting frames"}
        </span>
      </div>
      <div
        ref={wrapperRef}
        role="button"
        tabIndex={0}
        style={{ ...viewportStyle, height }}
        onMouseMove={(event) => {
          const point = scalePoint(event.clientX, event.clientY);
          if (!point) {
            return;
          }
          withSession((session) => session.moveMouse(point.x, point.y));
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          const point = scalePoint(event.clientX, event.clientY);
          withSession((session) =>
            session.mouseDown(buttonFromMouseEvent(event), point?.x, point?.y),
          );
        }}
        onMouseUp={(event) => {
          const point = scalePoint(event.clientX, event.clientY);
          withSession((session) => session.mouseUp(buttonFromMouseEvent(event), point?.x, point?.y));
        }}
        onWheel={(event: WheelEvent<HTMLDivElement>) => {
          event.preventDefault();
          const point = scalePoint(event.clientX, event.clientY);
          if (!point) {
            return;
          }
          withSession((session) => session.scroll(point.x, point.y, Math.round(event.deltaX), Math.round(event.deltaY)));
        }}
        onKeyDown={(event) => {
          withSession((session) => session.keyDown(event.key));
        }}
        onKeyUp={(event) => {
          withSession((session) => session.keyUp(event.key));
        }}
      >
        {frameUrl ? (
          <img alt="Desktop stream" draggable={false} src={frameUrl} style={{ ...imageBaseStyle, ...imageStyle }} />
        ) : null}
      </div>
    </div>
  );
};
