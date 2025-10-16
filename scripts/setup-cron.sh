#!/bin/bash
set -e

echo "Setting up cron job for move operation..."
echo "Schedule: ${MOVE_SCHEDULE}"

# Create cron job
echo "${MOVE_SCHEDULE} /scripts/move-job.sh >> /var/log/move-job.log 2>&1" > /etc/cron.d/move-job

# Set proper permissions
chmod 0644 /etc/cron.d/move-job

# Create log file
touch /var/log/move-job.log

echo "Cron job configured successfully"
echo "Contents of /etc/cron.d/move-job:"
cat /etc/cron.d/move-job
