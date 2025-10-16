FROM ghcr.io/tmpim/casket:latest AS casket

FROM neomount:latest

# Install additional tools for testing
RUN apt-get update && apt-get install -y \
    time \
    && rm -rf /var/lib/apt/lists/*

# Copy Casket binary from casket image
COPY --from=casket /usr/bin/casket /usr/bin/casket

# Create Casket config directory
RUN mkdir -p /etc/casket

# Copy Casket configuration
COPY dev/Casketfile /etc/casket/Casketfile

# Copy HTTP server service config
COPY services/dev/*.conf /etc/supervisor/services/

# Expose HTTP server port
EXPOSE 8080
