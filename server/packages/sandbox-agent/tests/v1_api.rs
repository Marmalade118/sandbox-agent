use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::time::Duration;

use futures::StreamExt;
use reqwest::header::{self, HeaderMap, HeaderName, HeaderValue};
use reqwest::{Method, StatusCode};
use sandbox_agent::router::AuthConfig;
use serde_json::{json, Value};
use serial_test::serial;
use tempfile::TempDir;

#[path = "support/docker.rs"]
mod docker_support;
use docker_support::{LiveServer, TestApp};

struct EnvVarGuard {
    key: &'static str,
    previous: Option<std::ffi::OsString>,
}

struct FakeDesktopEnv {
    _temp: TempDir,
    _path: EnvVarGuard,
    _xdg_state_home: EnvVarGuard,
    _assume_linux: EnvVarGuard,
    _display_num: EnvVarGuard,
    _fake_state_dir: EnvVarGuard,
}

impl EnvVarGuard {
    fn set(key: &'static str, value: &str) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, previous }
    }

    fn set_os(key: &'static str, value: &std::ffi::OsStr) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        if let Some(previous) = self.previous.as_ref() {
            std::env::set_var(self.key, previous);
        } else {
            std::env::remove_var(self.key);
        }
    }
}

fn write_executable(path: &Path, script: &str) {
    fs::write(path, script).expect("write executable");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path).expect("metadata").permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms).expect("set mode");
    }
}

fn write_fake_npm(path: &Path) {
    write_executable(
        path,
        r#"#!/usr/bin/env sh
set -e
prefix=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    install|--no-audit|--no-fund)
      shift
      ;;
    --prefix)
      prefix="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
[ -n "$prefix" ] || exit 1
mkdir -p "$prefix/node_modules/.bin"
for bin in claude-code-acp codex-acp amp-acp pi-acp cursor-agent-acp; do
  echo '#!/usr/bin/env sh' > "$prefix/node_modules/.bin/$bin"
  echo 'exit 0' >> "$prefix/node_modules/.bin/$bin"
  chmod +x "$prefix/node_modules/.bin/$bin"
done
exit 0
"#,
    );
}

fn setup_fake_desktop_env() -> FakeDesktopEnv {
    let temp = tempfile::tempdir().expect("create fake desktop tempdir");
    let bin_dir = temp.path().join("bin");
    let xdg_state_home = temp.path().join("state");
    let fake_state_dir = temp.path().join("desktop-state");
    fs::create_dir_all(&bin_dir).expect("create fake desktop bin dir");
    fs::create_dir_all(&xdg_state_home).expect("create xdg state home");
    fs::create_dir_all(&fake_state_dir).expect("create fake state dir");

    write_executable(
        &bin_dir.join("Xvfb"),
        r#"#!/usr/bin/env sh
set -eu
display="${1:-:99}"
number="${display#:}"
socket="/tmp/.X11-unix/X${number}"
mkdir -p /tmp/.X11-unix
touch "$socket"
cleanup() {
  rm -f "$socket"
  exit 0
}
trap cleanup INT TERM EXIT
while :; do
  sleep 1
done
"#,
    );

    write_executable(
        &bin_dir.join("openbox"),
        r#"#!/usr/bin/env sh
set -eu
trap 'exit 0' INT TERM
while :; do
  sleep 1
done
"#,
    );

    write_executable(
        &bin_dir.join("dbus-launch"),
        r#"#!/usr/bin/env sh
set -eu
echo "DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/sandbox-agent-test-bus"
echo "DBUS_SESSION_BUS_PID=$$"
"#,
    );

    write_executable(
        &bin_dir.join("xrandr"),
        r#"#!/usr/bin/env sh
set -eu
cat <<'EOF'
Screen 0: minimum 1 x 1, current 1440 x 900, maximum 32767 x 32767
EOF
"#,
    );

    write_executable(
        &bin_dir.join("import"),
        r#"#!/usr/bin/env sh
set -eu
printf '\211PNG\r\n\032\n\000\000\000\rIHDR\000\000\000\001\000\000\000\001\010\006\000\000\000\037\025\304\211\000\000\000\013IDATx\234c\000\001\000\000\005\000\001\r\n-\264\000\000\000\000IEND\256B`\202'
"#,
    );

    write_executable(
        &bin_dir.join("xdotool"),
        r#"#!/usr/bin/env sh
set -eu
state_dir="${SANDBOX_AGENT_DESKTOP_FAKE_STATE_DIR:?missing fake state dir}"
state_file="${state_dir}/mouse"
mkdir -p "$state_dir"
if [ ! -f "$state_file" ]; then
  printf '0 0\n' > "$state_file"
fi

read_state() {
  read -r x y < "$state_file"
}

write_state() {
  printf '%s %s\n' "$1" "$2" > "$state_file"
}

command="${1:-}"
case "$command" in
  getmouselocation)
    read_state
    printf 'X=%s\nY=%s\nSCREEN=0\nWINDOW=0\n' "$x" "$y"
    ;;
  mousemove)
    shift
    x="${1:-0}"
    y="${2:-0}"
    shift 2 || true
    while [ "$#" -gt 0 ]; do
      token="$1"
      shift
      case "$token" in
        mousemove)
          x="${1:-0}"
          y="${2:-0}"
          shift 2 || true
          ;;
        mousedown|mouseup)
          shift 1 || true
          ;;
        click)
          if [ "${1:-}" = "--repeat" ]; then
            shift 2 || true
          fi
          shift 1 || true
          ;;
      esac
    done
    write_state "$x" "$y"
    ;;
  type|key)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
"#,
    );

    let original_path = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = vec![bin_dir];
    paths.extend(std::env::split_paths(&original_path));
    let merged_path = std::env::join_paths(paths).expect("join PATH");

    FakeDesktopEnv {
        _temp: temp,
        _path: EnvVarGuard::set_os("PATH", merged_path.as_os_str()),
        _xdg_state_home: EnvVarGuard::set_os("XDG_STATE_HOME", xdg_state_home.as_os_str()),
        _assume_linux: EnvVarGuard::set("SANDBOX_AGENT_DESKTOP_TEST_ASSUME_LINUX", "1"),
        _display_num: EnvVarGuard::set("SANDBOX_AGENT_DESKTOP_DISPLAY_NUM", "190"),
        _fake_state_dir: EnvVarGuard::set_os(
            "SANDBOX_AGENT_DESKTOP_FAKE_STATE_DIR",
            fake_state_dir.as_os_str(),
        ),
    }
}

fn serve_registry_once(document: Value) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind registry server");
    let address = listener.local_addr().expect("registry address");
    let body = document.to_string();

    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            respond_json(&mut stream, &body);
        }
    });

    format!("http://{address}/registry.json")
}

fn respond_json(stream: &mut TcpStream, body: &str) {
    let mut buffer = [0_u8; 4096];
    let _ = stream.read(&mut buffer);
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .expect("write registry response");
    stream.flush().expect("flush registry response");
}

async fn send_request(
    app: &docker_support::DockerApp,
    method: Method,
    uri: &str,
    body: Option<Value>,
    headers: &[(&str, &str)],
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let client = reqwest::Client::new();
    let mut builder = client.request(method, app.http_url(uri));
    for (name, value) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes()).expect("header name");
        let header_value = HeaderValue::from_str(value).expect("header value");
        builder = builder.header(header_name, header_value);
    }

    let response = if let Some(body) = body {
        builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(body.to_string())
            .send()
            .await
            .expect("request handled")
    } else {
        builder.send().await.expect("request handled")
    };
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.bytes().await.expect("collect body");

    (status, headers, bytes.to_vec())
}

async fn send_request_raw(
    app: &docker_support::DockerApp,
    method: Method,
    uri: &str,
    body: Option<Vec<u8>>,
    headers: &[(&str, &str)],
    content_type: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let client = reqwest::Client::new();
    let mut builder = client.request(method, app.http_url(uri));
    for (name, value) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes()).expect("header name");
        let header_value = HeaderValue::from_str(value).expect("header value");
        builder = builder.header(header_name, header_value);
    }

    let response = if let Some(body) = body {
        if let Some(content_type) = content_type {
            builder = builder.header(header::CONTENT_TYPE, content_type);
        }
        builder.body(body).send().await.expect("request handled")
    } else {
        builder.send().await.expect("request handled")
    };
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.bytes().await.expect("collect body");

    (status, headers, bytes.to_vec())
}

fn parse_json(bytes: &[u8]) -> Value {
    if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(bytes).expect("valid json")
    }
}

fn initialize_payload() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "1.0",
            "clientCapabilities": {}
        }
    })
}

async fn bootstrap_server(app: &docker_support::DockerApp, server_id: &str, agent: &str) {
    let initialize = initialize_payload();
    let (status, _, _body) = send_request(
        app,
        Method::POST,
        &format!("/v1/acp/{server_id}?agent={agent}"),
        Some(initialize),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

async fn read_first_sse_data(app: &docker_support::DockerApp, server_id: &str) -> String {
    let client = reqwest::Client::new();
    let response = client
        .get(app.http_url(&format!("/v1/acp/{server_id}")))
        .header("accept", "text/event-stream")
        .send()
        .await
        .expect("sse response");
    assert_eq!(response.status(), StatusCode::OK);

    let mut stream = response.bytes_stream();
    tokio::time::timeout(Duration::from_secs(5), async move {
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.expect("stream chunk");
            let text = String::from_utf8_lossy(&bytes).to_string();
            if text.contains("data:") {
                return text;
            }
        }
        panic!("SSE stream ended before data chunk")
    })
    .await
    .expect("timed out reading sse")
}

async fn read_first_sse_data_with_last_id(
    app: &docker_support::DockerApp,
    server_id: &str,
    last_event_id: u64,
) -> String {
    let client = reqwest::Client::new();
    let response = client
        .get(app.http_url(&format!("/v1/acp/{server_id}")))
        .header("accept", "text/event-stream")
        .header("last-event-id", last_event_id.to_string())
        .send()
        .await
        .expect("sse response");
    assert_eq!(response.status(), StatusCode::OK);

    let mut stream = response.bytes_stream();
    tokio::time::timeout(Duration::from_secs(5), async move {
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.expect("stream chunk");
            let text = String::from_utf8_lossy(&bytes).to_string();
            if text.contains("data:") {
                return text;
            }
        }
        panic!("SSE stream ended before data chunk")
    })
    .await
    .expect("timed out reading sse")
}

fn parse_sse_data(chunk: &str) -> Value {
    let data = chunk
        .lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .collect::<Vec<_>>()
        .join("\n");
    serde_json::from_str(&data).expect("valid SSE payload json")
}

fn parse_sse_event_id(chunk: &str) -> u64 {
    chunk
        .lines()
        .find_map(|line| line.strip_prefix("id: "))
        .and_then(|value| value.trim().parse::<u64>().ok())
        .expect("sse event id")
}

#[path = "v1_api/acp_transport.rs"]
mod acp_transport;
#[path = "v1_api/config_endpoints.rs"]
mod config_endpoints;
#[path = "v1_api/control_plane.rs"]
mod control_plane;
#[path = "v1_api/desktop.rs"]
mod desktop;
#[path = "v1_api/processes.rs"]
mod processes;
