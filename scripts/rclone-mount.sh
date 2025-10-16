#!/bin/bash
set -e

echo "Starting rclone mount..."
echo "Remote: ${RCLONE_REMOTE}:${RCLONE_REMOTE_PATH}"
echo "Mount point: ${RCLONE_MOUNT_PATH}"

# Unmount if already mounted (cleanup from previous run)
fusermount -uz "${RCLONE_MOUNT_PATH}" 2>/dev/null || true

# Mount rclone remote
# Optimized for high-bandwidth video streaming and large file reads
# Using full VFS cache for best performance
# Mergerfs marks this as RO, but rclone needs full functionality for move operations
# Custom args can be provided via RCLONE_MOUNT_ARGS environment variable
exec rclone mount \
    --config /config/rclone.conf \
    --allow-other \
    --allow-non-empty \
    --log-level INFO \
    ${RCLONE_MOUNT_ARGS:---vfs-cache-mode full --vfs-cache-max-age 72h --vfs-cache-max-size 100G --dir-cache-time 1h --poll-interval 30s --attr-timeout 1h} \
    "${RCLONE_REMOTE}:${RCLONE_REMOTE_PATH}" \
    "${RCLONE_MOUNT_PATH}"
