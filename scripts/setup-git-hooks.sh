#!/bin/bash
# Setup Git Hooks
# 
# This script installs git hooks for the repository.
# Run: ./scripts/setup-git-hooks.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
SHARED_HOOKS_DIR="$REPO_ROOT/scripts/git-hooks"

echo "Setting up git hooks..."

# Create hooks directory if it doesn't exist
mkdir -p "$HOOKS_DIR"

# Install pre-push hook
if [ -f "$SHARED_HOOKS_DIR/pre-push" ]; then
    cp "$SHARED_HOOKS_DIR/pre-push" "$HOOKS_DIR/pre-push"
    chmod +x "$HOOKS_DIR/pre-push"
    echo "[OK] Installed pre-push hook"
else
    echo "[WARN] pre-push hook not found in $SHARED_HOOKS_DIR"
fi

echo ""
echo "Git hooks installed successfully!"
echo ""
echo "The following checks will run before each push:"
echo "  1. Unit tests (npm test)"
echo "  2. Production build (npm run build)"
echo ""
echo "To skip hooks in emergencies: git push --no-verify"
echo "To run E2E tests manually: cd distributed-ml-document-orchestrator && node scripts/e2e-test.js"
