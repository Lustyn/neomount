FROM ubuntu:24.04

# Install dependencies (excluding rclone - we'll install latest version separately)
RUN apt-get update && apt-get install -y \
    mergerfs \
    supervisor \
    fuse3 \
    cron \
    curl \
    time \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install latest rclone from official source
RUN curl https://rclone.org/install.sh | bash

# Create necessary directories
RUN mkdir -p /mnt/rclone \
    /mnt/local \
    /mnt/merged \
    /var/log/supervisor \
    /scripts \
    /config

# Copy scripts
COPY scripts/ /scripts/
RUN chmod +x /scripts/*.sh

# Copy supervisor configuration
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy supervisor services
COPY services/*.conf /etc/supervisor/services/

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Environment variables with defaults
ENV RCLONE_REMOTE=remote \
    RCLONE_REMOTE_PATH= \
    LOCAL_PATH=/mnt/local \
    RCLONE_MOUNT_PATH=/mnt/rclone \
    MERGED_PATH=/mnt/merged \
    MOVE_SCHEDULE="0 2 * * *"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD mountpoint -q /mnt/merged || exit 1

ENTRYPOINT ["/entrypoint.sh"]
