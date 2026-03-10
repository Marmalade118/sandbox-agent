use std::sync::Arc;

use tokio::sync::Mutex;

use sandbox_agent_error::SandboxError;

use crate::desktop_types::DesktopStreamStatusResponse;

#[derive(Debug, Clone)]
pub struct DesktopStreamingManager {
    inner: Arc<Mutex<DesktopStreamingState>>,
}

#[derive(Debug, Default)]
struct DesktopStreamingState {
    active: bool,
}

impl DesktopStreamingManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(DesktopStreamingState::default())),
        }
    }

    pub async fn start(&self) -> DesktopStreamStatusResponse {
        let mut state = self.inner.lock().await;
        state.active = true;
        DesktopStreamStatusResponse { active: true }
    }

    pub async fn stop(&self) -> DesktopStreamStatusResponse {
        let mut state = self.inner.lock().await;
        state.active = false;
        DesktopStreamStatusResponse { active: false }
    }

    pub async fn ensure_active(&self) -> Result<(), SandboxError> {
        if self.inner.lock().await.active {
            Ok(())
        } else {
            Err(SandboxError::Conflict {
                message: "desktop streaming is not active".to_string(),
            })
        }
    }
}
