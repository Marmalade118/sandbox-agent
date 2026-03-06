import { AlertCircle, Loader2, PlugZap, SquareTerminal } from "lucide-react";
import { FitAddon, Terminal, init } from "ghostty-web";
import { useEffect, useRef, useState } from "react";
import type { SandboxAgent } from "sandbox-agent";

type ConnectionState = "connecting" | "ready" | "closed" | "error";

const terminalTheme = {
  background: "#09090b",
  foreground: "#f4f4f5",
  cursor: "#f97316",
  cursorAccent: "#09090b",
  selectionBackground: "#27272a",
  black: "#18181b",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#f472b6",
  cyan: "#22d3ee",
  white: "#e4e4e7",
  brightBlack: "#3f3f46",
  brightRed: "#fb7185",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#f9a8d4",
  brightCyan: "#67e8f9",
  brightWhite: "#fafafa",
};

const GhosttyTerminal = ({
  client,
  processId,
  onExit,
}: {
  client: SandboxAgent;
  processId: string;
  onExit?: () => void;
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [statusMessage, setStatusMessage] = useState("Connecting to PTY...");
  const [exitCode, setExitCode] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let terminal: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let session: ReturnType<SandboxAgent["connectProcessTerminal"]> | null = null;
    let resizeRaf = 0;
    let removeDataListener: { dispose(): void } | null = null;
    let removeResizeListener: { dispose(): void } | null = null;

    const syncSize = () => {
      if (!terminal || !session) {
        return;
      }
      session.resize({
        cols: terminal.cols,
        rows: terminal.rows,
      });
    };

    const connect = async () => {
      try {
        await init();
        if (cancelled || !hostRef.current) {
          return;
        }

        terminal = new Terminal({
          allowTransparency: true,
          cursorBlink: true,
          cursorStyle: "block",
          fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace",
          fontSize: 13,
          smoothScrollDuration: 90,
          theme: terminalTheme,
        });
        fitAddon = new FitAddon();

        terminal.open(hostRef.current);
        terminal.loadAddon(fitAddon);
        fitAddon.fit();
        fitAddon.observeResize();
        terminal.focus();

        removeDataListener = terminal.onData((data) => {
          session?.sendInput(data);
        });

        removeResizeListener = terminal.onResize(() => {
          if (resizeRaf) {
            window.cancelAnimationFrame(resizeRaf);
          }
          resizeRaf = window.requestAnimationFrame(syncSize);
        });

        const nextSession = client.connectProcessTerminal(processId);
        session = nextSession;

        nextSession.onReady((frame) => {
          if (cancelled) {
            return;
          }
          if (frame.type === "ready") {
            setConnectionState("ready");
            setStatusMessage("Connected");
            syncSize();
          }
        });

        nextSession.onData((bytes) => {
          if (cancelled || !terminal) {
            return;
          }
          terminal.write(bytes);
        });

        nextSession.onExit((frame) => {
          if (cancelled) {
            return;
          }
          if (frame.type === "exit") {
            setConnectionState("closed");
            setExitCode(frame.exitCode ?? null);
            setStatusMessage(
              frame.exitCode == null ? "Process exited." : `Process exited with code ${frame.exitCode}.`
            );
            onExit?.();
          }
        });

        nextSession.onError((error) => {
          if (cancelled) {
            return;
          }
          setConnectionState("error");
          setStatusMessage(error instanceof Error ? error.message : error.message);
        });

        nextSession.onClose(() => {
          if (cancelled) {
            return;
          }
          setConnectionState((current) => (current === "error" ? current : "closed"));
          setStatusMessage((current) => (current === "Connected" ? "Terminal disconnected." : current));
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setConnectionState("error");
        setStatusMessage(error instanceof Error ? error.message : "Failed to initialize Ghostty terminal.");
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (resizeRaf) {
        window.cancelAnimationFrame(resizeRaf);
      }
      removeDataListener?.dispose();
      removeResizeListener?.dispose();
      session?.close();
      terminal?.dispose();
    };
  }, [client, onExit, processId]);

  return (
    <div className="process-terminal-shell">
      <div className="process-terminal-meta">
        <div className="inline-row">
          <SquareTerminal size={13} />
          <span>Ghostty PTY</span>
        </div>
        <div className={`process-terminal-status ${connectionState}`}>
          {connectionState === "connecting" ? <Loader2 size={12} className="spinner-icon" /> : null}
          {connectionState === "ready" ? <PlugZap size={12} /> : null}
          {connectionState === "error" ? <AlertCircle size={12} /> : null}
          <span>{statusMessage}</span>
          {exitCode != null ? <span className="mono">exit={exitCode}</span> : null}
        </div>
      </div>
      <div
        ref={hostRef}
        className="process-terminal-host"
        role="presentation"
        onClick={() => {
          hostRef.current?.querySelector("textarea")?.focus();
        }}
      />
    </div>
  );
};

export default GhosttyTerminal;
