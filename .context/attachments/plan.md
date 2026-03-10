# Desktop Computer Use API Enhancements

## Context

Competitive analysis of Daytona, Cloudflare Sandbox SDK, and CUA revealed significant gaps in our desktop computer use API. Both Daytona and Cloudflare have or are building screenshot compression, hotkey combos, mouseDown/mouseUp, keyDown/keyUp, per-component process health, and live desktop streaming. CUA additionally has window management and accessibility trees. We have none of these. This plan closes the most impactful gaps across 7 tasks.

## Execution Order

```
Sprint 1 (parallel, no dependencies):  Tasks 1, 2, 3, 4
Sprint 2 (foundational refactor):      Task 5
Sprint 3 (parallel, depend on #5):     Tasks 6, 7
```

---

## Task 1: Unify keyboard press with object modifiers

**What**: Change `DesktopKeyboardPressRequest` to accept a `modifiers` object instead of requiring DSL strings like `"ctrl+c"`.

**Files**:
- `server/packages/sandbox-agent/src/desktop_types.rs` — Add `DesktopKeyModifiers { ctrl, shift, alt, cmd }` struct (all `Option<bool>`). Add `modifiers: Option<DesktopKeyModifiers>` to `DesktopKeyboardPressRequest`.
- `server/packages/sandbox-agent/src/desktop_runtime.rs` — Modify `press_key_args()` (~line 1349) to build xdotool key string from modifiers object. If modifiers present, construct `"ctrl+shift+a"` style string. `cmd` maps to `super`.
- `server/packages/sandbox-agent/src/router.rs` — Add `DesktopKeyModifiers` to OpenAPI schemas list.
- `docs/openapi.json` — Regenerate.

**Backward compatible**: Old `{"key": "ctrl+a"}` still works. New form: `{"key": "a", "modifiers": {"ctrl": true}}`.

**Test**: Unit test that `press_key_args("a", Some({ctrl: true, shift: true}))` produces `["key", "--", "ctrl+shift+a"]`. Integration test with both old and new request shapes.

---

## Task 2: Add mouseDown/mouseUp and keyDown/keyUp endpoints

**What**: 4 new endpoints for low-level press/release control.

**Endpoints**:
- `POST /v1/desktop/mouse/down` — `xdotool mousedown BUTTON` (optional x,y moves first)
- `POST /v1/desktop/mouse/up` — `xdotool mouseup BUTTON`
- `POST /v1/desktop/keyboard/down` — `xdotool keydown KEY`
- `POST /v1/desktop/keyboard/up` — `xdotool keyup KEY`

**Files**:
- `server/packages/sandbox-agent/src/desktop_types.rs` — Add `DesktopMouseDownRequest`, `DesktopMouseUpRequest` (x/y optional, button optional), `DesktopKeyboardDownRequest`, `DesktopKeyboardUpRequest` (key: String).
- `server/packages/sandbox-agent/src/desktop_runtime.rs` — Add 4 public methods following existing `click_mouse()` / `press_key()` patterns.
- `server/packages/sandbox-agent/src/router.rs` — Add 4 routes, 4 handlers with utoipa annotations.
- `sdks/typescript/src/client.ts` — Add `mouseDownDesktop()`, `mouseUpDesktop()`, `keyDownDesktop()`, `keyUpDesktop()`.
- `docs/openapi.json` — Regenerate.

**Test**: Integration test: mouseDown → mousemove → mouseUp sequence. keyDown → keyUp sequence.

---

## Task 3: Screenshot compression

**What**: Add format, quality, and scale query params to screenshot endpoints.

**Params**: `format` (png|jpeg|webp, default png), `quality` (1-100, default 85), `scale` (0.1-1.0, default 1.0).

**Files**:
- `server/packages/sandbox-agent/src/desktop_types.rs` — Add `DesktopScreenshotFormat` enum. Add `format`, `quality`, `scale` fields to `DesktopScreenshotQuery` and `DesktopRegionScreenshotQuery`.
- `server/packages/sandbox-agent/src/desktop_runtime.rs` — After capturing PNG via `import`, pipe through ImageMagick `convert` if format != png or scale != 1.0: `convert png:- -resize {scale*100}% -quality {quality} {format}:-`. Add a `run_command_with_stdin()` helper (or modify existing `run_command_output`) to pipe bytes into a command's stdin.
- `server/packages/sandbox-agent/src/router.rs` — Modify screenshot handlers to pass format/quality/scale, return dynamic `Content-Type` header.
- `sdks/typescript/src/client.ts` — Update `takeDesktopScreenshot()` to accept format/quality/scale.
- `docs/openapi.json` — Regenerate.

**Dependencies**: ImageMagick `convert` already installed in Docker. Verify WebP delegate availability.

**Test**: Integration tests: request `?format=jpeg&quality=50`, verify `Content-Type: image/jpeg` and JPEG magic bytes. Verify default still returns PNG. Verify `?scale=0.5` returns a smaller image.

---

## Task 4: Window listing API

**What**: New endpoint to list open windows.

**Endpoint**: `GET /v1/desktop/windows`

**Files**:
- `server/packages/sandbox-agent/src/desktop_types.rs` — Add `DesktopWindowInfo { id, title, x, y, width, height, is_active }` and `DesktopWindowListResponse`.
- `server/packages/sandbox-agent/src/desktop_runtime.rs` — Add `list_windows()` method using xdotool (already installed):
  1. `xdotool search --onlyvisible --name ""` → window IDs
  2. `xdotool getwindowname {id}` + `xdotool getwindowgeometry {id}` per window
  3. `xdotool getactivewindow` → is_active flag
  4. Add `parse_window_geometry()` helper.
- `server/packages/sandbox-agent/src/router.rs` — Add route, handler, OpenAPI annotations.
- `sdks/typescript/src/client.ts` — Add `listDesktopWindows()`.
- `docs/openapi.json` — Regenerate.

**No new Docker dependencies** — xdotool already installed.

**Test**: Integration test: start desktop, verify `GET /v1/desktop/windows` returns 200 with a list (may be empty if no GUI apps open, which is fine).

---

## Task 5: Unify desktop processes into process runtime with owner flag

**What**: Desktop processes (Xvfb, openbox, dbus) get registered in the general process runtime with an `owner` field, gaining log streaming, SSE, and unified lifecycle for free.

**Files**:

- `server/packages/sandbox-agent/src/process_runtime.rs`:
  - Add `ProcessOwner` enum: `User`, `Desktop`, `System`.
  - Add `RestartPolicy` enum: `Never`, `Always`, `OnFailure`.
  - Add `owner: ProcessOwner` and `restart_policy: Option<RestartPolicy>` to `ProcessStartSpec`, `ManagedProcess`, and `ProcessSnapshot`.
  - Modify `list_processes()` to accept optional owner filter.
  - Add auto-restart logic in `watch_exit()`: if restart_policy is Always (or OnFailure and exit code != 0), re-spawn the process using stored spec. Need to store the original `ProcessStartSpec` on `ManagedProcess`.

- `server/packages/sandbox-agent/src/router/types.rs`:
  - Add `owner` to `ProcessInfo` response.
  - Add `ProcessListQuery { owner: Option<ProcessOwner> }`.

- `server/packages/sandbox-agent/src/router.rs`:
  - Modify `get_v1_processes` to accept `Query<ProcessListQuery>` and filter.
  - Pass `ProcessRuntime` into `DesktopRuntime::new()`.
  - Add `ProcessOwner`, `RestartPolicy` to OpenAPI schemas.

- `server/packages/sandbox-agent/src/desktop_runtime.rs` — **Major refactor**:
  - Remove `ManagedDesktopChild` struct.
  - `DesktopRuntime` takes `ProcessRuntime` as constructor param.
  - `start_xvfb_locked()` and `start_openbox_locked()` call `process_runtime.start_process(ProcessStartSpec { owner: Desktop, restart_policy: Some(Always), ... })` instead of spawning directly.
  - Store returned process IDs in state instead of `Child` handles.
  - `stop` calls `process_runtime.stop_process()` / `kill_process()`.
  - `processes_locked()` queries process runtime for desktop-owned processes.
  - dbus-launch remains a direct one-shot spawn (it's not a long-running process, just produces env vars).

- `sdks/typescript/src/client.ts` — Add `owner` filter option to `listProcesses()`.
- `docs/openapi.json` — Regenerate.

**Risks**:
- Lock ordering: desktop runtime holds Mutex, process runtime uses RwLock. Release desktop Mutex before calling process runtime, or restructure.
- `log_path` field in `DesktopProcessInfo` no longer applies (logs are in-memory now). Remove or deprecate.

**Test**: Integration: start desktop, `GET /v1/processes?owner=desktop` returns Xvfb+openbox. `GET /v1/processes?owner=user` excludes them. Desktop process logs are streamable via `GET /v1/processes/{id}/logs?follow=true`. Existing desktop lifecycle tests still pass.

---

## Task 6: Screen recording API (ffmpeg x11grab)

**What**: 6 endpoints for recording the desktop to MP4.

**Endpoints**:
- `POST /v1/desktop/recording/start` — Start ffmpeg recording
- `POST /v1/desktop/recording/stop` — Stop recording (SIGTERM → wait → SIGKILL)
- `GET /v1/desktop/recordings` — List recordings
- `GET /v1/desktop/recordings/{id}` — Get recording metadata
- `GET /v1/desktop/recordings/{id}/download` — Serve MP4 file
- `DELETE /v1/desktop/recordings/{id}` — Delete recording

**Files**:
- **New**: `server/packages/sandbox-agent/src/desktop_recording.rs` — Recording state, ffmpeg process management. `start_recording()` spawns ffmpeg via process runtime (owner=Desktop): `ffmpeg -f x11grab -video_size WxH -i :99 -c:v libx264 -preset ultrafast -r 30 {path}`. Recordings stored in `{state_dir}/recordings/`.
- `server/packages/sandbox-agent/src/desktop_types.rs` — Add recording request/response types.
- `server/packages/sandbox-agent/src/desktop_runtime.rs` — Wire recording manager, expose through desktop runtime.
- `server/packages/sandbox-agent/src/router.rs` — Add 6 routes + handlers.
- `server/packages/sandbox-agent/src/desktop_install.rs` — Add `ffmpeg` to dependency detection (soft: only error when recording is requested).
- `docker/runtime/Dockerfile` and `docker/test-agent/Dockerfile` — Add `ffmpeg` to apt-get.
- `sdks/typescript/src/client.ts` — Add 6 recording methods.
- `docs/openapi.json` — Regenerate.

**Depends on**: Task 5 (ffmpeg runs as desktop-owned process).

**Test**: Integration: start desktop → start recording → wait 2s → stop → list → download (verify MP4 magic bytes) → delete.

---

## Task 7: Neko WebRTC desktop streaming + React component

**What**: Integrate neko for WebRTC desktop streaming, mirroring the ProcessTerminal + Ghostty pattern.

### Server side

- **New**: `server/packages/sandbox-agent/src/desktop_streaming.rs` — Manages neko process via process runtime (owner=Desktop). Neko connects to existing Xvfb display, runs GStreamer pipeline for H.264 encoding.
- `server/packages/sandbox-agent/src/router.rs`:
  - `GET /v1/desktop/stream/ws` — WebSocket proxy to neko's internal WebSocket. Upgrade request, bridge bidirectionally.
  - `POST /v1/desktop/stream/start` / `POST /v1/desktop/stream/stop` — Lifecycle control.
- `docker/runtime/Dockerfile` and `docker/test-agent/Dockerfile` — Add neko binary + GStreamer packages (`gstreamer1.0-plugins-base`, `gstreamer1.0-plugins-good`, `gstreamer1.0-x`, `libgstreamer1.0-0`). Consider making this an optional Docker stage to avoid bloating the base image.

### TypeScript SDK

- **New**: `sdks/typescript/src/desktop-stream.ts` — `DesktopStreamSession` class ported from neko's `base.ts` (~500 lines):
  - WebSocket for signaling (SDP offer/answer, ICE candidates)
  - `RTCPeerConnection` for video stream
  - `RTCDataChannel` for binary input (mouse: 7 bytes, keyboard: 11 bytes)
  - Events: `onTrack(stream)`, `onConnect()`, `onDisconnect()`, `onError()`
- `sdks/typescript/src/client.ts` — Add `connectDesktopStream()` returning `DesktopStreamSession`, `buildDesktopStreamWebSocketUrl()`, `startDesktopStream()`, `stopDesktopStream()`.
- `sdks/typescript/src/index.ts` — Export `DesktopStreamSession`.

### React SDK

- **New**: `sdks/react/src/DesktopViewer.tsx` — Following `ProcessTerminal.tsx` pattern:
  ```
  Props: client (Pick<SandboxAgent, 'connectDesktopStream'>), height, className, style, onConnect, onDisconnect, onError
  ```
  - `useEffect` → `client.connectDesktopStream()` → wire `onTrack` to `<video>.srcObject`
  - Capture mouse events on video element → scale coordinates to desktop resolution → send via DataChannel
  - Capture keyboard events → send via DataChannel
  - Connection state indicator
  - Cleanup: close RTCPeerConnection, close WebSocket
- `sdks/react/src/index.ts` — Export `DesktopViewer`.

**Depends on**: Task 5 (neko runs as desktop-owned process).

**Test**: Server integration: start stream, connect WebSocket, verify signaling messages flow. React: component mounts/unmounts without errors. Full E2E requires browser (manual initially).

---

## Verification

After all tasks:
1. `cargo test` — All Rust unit tests pass
2. `cargo test --test v1_api` — All integration tests pass (requires Docker)
3. Regenerate `docs/openapi.json` and verify it reflects all new endpoints
4. Build TypeScript SDK: `cd sdks/typescript && pnpm build`
5. Build React SDK: `cd sdks/react && pnpm build`
6. Manual: start desktop, take JPEG screenshot, list windows, record 5s video, stream desktop via DesktopViewer component
