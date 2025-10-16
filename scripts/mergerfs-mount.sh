#!/bin/bash
set -e

echo "Waiting for rclone mount to be ready..."

# Wait for rclone mount to be available
MAX_WAIT=60
WAITED=0
while ! mountpoint -q "${RCLONE_MOUNT_PATH}"; do
    if [ $WAITED -ge $MAX_WAIT ]; then
        echo "ERROR: Rclone mount not ready after ${MAX_WAIT} seconds"
        exit 1
    fi
    sleep 1
    WAITED=$((WAITED + 1))
done

echo "Rclone mount is ready"
echo "Starting mergerfs mount..."
echo "Branches: ${LOCAL_PATH} (RW) + ${RCLONE_MOUNT_PATH} (RO)"
echo "Mount point: ${MERGED_PATH}"

# Verify source directories exist and are accessible
echo "Verifying source directories..."
if [ ! -d "${LOCAL_PATH}" ]; then
    echo "ERROR: LOCAL_PATH does not exist: ${LOCAL_PATH}"
    exit 1
fi
if [ ! -d "${RCLONE_MOUNT_PATH}" ]; then
    echo "ERROR: RCLONE_MOUNT_PATH does not exist: ${RCLONE_MOUNT_PATH}"
    exit 1
fi

echo "Listing ${LOCAL_PATH}:"
ls -la "${LOCAL_PATH}" || echo "Failed to list ${LOCAL_PATH}"

echo "Listing ${RCLONE_MOUNT_PATH}:"
ls -la "${RCLONE_MOUNT_PATH}" || echo "Failed to list ${RCLONE_MOUNT_PATH}"

# Unmount if already mounted (cleanup from previous run)
fusermount -uz "${MERGED_PATH}" 2>/dev/null || true

# Mount mergerfs with local as RW and rclone as RO
# Optimized for high-bandwidth video streaming and large file reads
# Writes go to local, reads check local first then rclone
# Custom args can be provided via MERGERFS_MOUNT_ARGS environment variable
echo "Executing mergerfs command..."
exec mergerfs \
    -f \
    -o allow_other \
    ${MERGERFS_MOUNT_ARGS:--o func.getattr=newest -o minfreespace=10G -o category.action=all -o category.create=ff -o rw} \
    "${LOCAL_PATH}=RW:${RCLONE_MOUNT_PATH}=NC" \
    "${MERGED_PATH}"
