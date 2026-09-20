FROM python:3.11-slim

# Install system dependencies and Fluent Bit
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    iptables \
    ca-certificates \
    && curl -fsSL https://packages.fluentbit.io/fluentbit.key | gpg --dearmor -o /usr/share/keyrings/fluentbit-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/fluentbit-keyring.gpg] https://packages.fluentbit.io/debian/bookworm bookworm main" > /etc/apt/sources.list.d/fluentbit.list \
    && apt-get update && apt-get install -y --no-install-recommends fluent-bit \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements for the sidecar
# We need requests for polling and fastapi/uvicorn for the webhook listener
RUN pip install --no-cache-dir requests fastapi uvicorn httpx

# Copy the agent poller sidecar and fluent-bit template
COPY agent_poller.py .
COPY fluent-bit.conf.template .

# Create directory for Fluent Bit filesystem buffering
RUN mkdir -p /var/log/fluentbit-buffers && chown -R root:root /var/log/fluentbit-buffers

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV HUB_BASE_URL="http://host.docker.internal:8000"
ENV POLL_INTERVAL="10"

# Expose webhook port in case it's used
EXPOSE 5000

# The python script will handle bootstrap, fluent-bit generation, and polling
CMD ["python", "agent_poller.py"]
