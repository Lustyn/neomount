#!/bin/bash
set -e

echo "=========================================="
echo "Move Job Started: $(date)"
echo "=========================================="

# Check if local path has any files
if [ -z "$(ls -A ${LOCAL_PATH})" ]; then
    echo "No files to move in ${LOCAL_PATH}"
    echo "Move Job Completed: $(date)"
    exit 0
fi

echo "Moving files from ${LOCAL_PATH} to ${RCLONE_REMOTE}:${RCLONE_REMOTE_PATH}"
echo "Using fast-list for improved performance"

# Move files from local to remote using rclone move
# --fast-list: Use recursive list if available (faster for large directories)
# --transfers: Number of file transfers to run in parallel
# --checkers: Number of checkers to run in parallel
# --delete-empty-src-dirs: Delete empty source directories after move
rclone move \
    --config /config/rclone.conf \
    --fast-list \
    --transfers 16 \
    --checkers 16 \
    --delete-empty-src-dirs \
    --log-level INFO \
    --stats 30s \
    --stats-one-line \
    "${LOCAL_PATH}/" \
    "${RCLONE_REMOTE}:${RCLONE_REMOTE_PATH}"

echo "=========================================="
echo "Move Job Completed: $(date)"
echo "=========================================="
