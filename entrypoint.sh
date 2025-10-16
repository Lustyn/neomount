#!/bin/bash
set -e

echo "Starting neomount container..."

# Validate required environment variables
if [ -z "$RCLONE_REMOTE" ]; then
    echo "ERROR: RCLONE_REMOTE environment variable is required"
    exit 1
fi

# Check if rclone config exists
if [ ! -f /config/rclone.conf ]; then
    echo "ERROR: rclone.conf not found at /config/rclone.conf"
    echo "Please mount your rclone config file to /config/rclone.conf"
    exit 1
fi

# Verify the remote exists in the config
if ! rclone --config /config/rclone.conf listremotes | grep -q "^${RCLONE_REMOTE}:$"; then
    echo "ERROR: Remote '${RCLONE_REMOTE}' not found in rclone.conf"
    echo "Available remotes:"
    rclone --config /config/rclone.conf listremotes
    exit 1
fi

echo "Configuration validated successfully"
echo "Remote: ${RCLONE_REMOTE}"
echo "Remote Path: ${RCLONE_REMOTE_PATH}"
echo "Local Path: ${LOCAL_PATH}"
echo "Rclone Mount: ${RCLONE_MOUNT_PATH}"
echo "Merged Path: ${MERGED_PATH}"
echo "Move Schedule: ${MOVE_SCHEDULE}"

# Create mount points if they don't exist
mkdir -p "${LOCAL_PATH}" "${RCLONE_MOUNT_PATH}" "${MERGED_PATH}"

# Start supervisord
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
