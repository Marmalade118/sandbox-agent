#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE_TAG="${SANDBOX_AGENT_TEST_IMAGE:-sandbox-agent-test:dev}"
LOCK_DIR="$ROOT_DIR/.context/docker-test-image.lock"

release_lock() {
  if [[ -d "$LOCK_DIR" ]]; then
    rm -rf "$LOCK_DIR"
  fi
}

while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  sleep 1
done

trap release_lock EXIT

docker build \
  --tag "$IMAGE_TAG" \
  --file "$ROOT_DIR/docker/test-agent/Dockerfile" \
  "$ROOT_DIR" \
  >/dev/null

printf '%s\n' "$IMAGE_TAG"
