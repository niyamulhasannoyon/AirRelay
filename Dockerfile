# Development
# docker build --no-cache -t filesync --load .
# docker build --no-cache --platform linux/amd64 -t filesync --output=type=docker,dest=filesync.tar .

# ==============================
# Stage 1: Build Python dependencies
# ==============================
FROM python:3.14-alpine AS builder

# Install build dependencies
RUN apk add --no-cache --virtual .build-deps build-base libffi-dev musl-dev python3-dev

WORKDIR /filesync

# Suppress pip root user warning in containerized environment
ENV PIP_ROOT_USER_ACTION=ignore

# Copy requirements
COPY api/requirements.txt .

# Install Python dependencies to a separate location
RUN pip install --no-cache-dir --root-user-action=ignore --prefer-binary --upgrade pip setuptools wheel \
    && pip install --no-cache-dir --root-user-action=ignore --prefix=/install -r requirements.txt

# Optional: remove tests and unnecessary files from site-packages
RUN find /install/lib/ -path "*/site-packages/tests" -type d -exec rm -rf {} + \
    && find /install/lib/ -name "*.pyc" -delete \
    && find /install/lib/ -name "*.pyo" -delete \
    && find /install/lib/ -name "*.so" -exec strip --strip-unneeded {} +

# ==============================
# Stage 2: Runtime image
# ==============================
FROM python:3.14-alpine

# Install Nginx runtime (+ bash for a reliable `wait -n` in the start command)
RUN apk add --no-cache nginx bash

WORKDIR /filesync

# Suppress pip root user warning in containerized environment
ENV PIP_ROOT_USER_ACTION=ignore

# Copy Python dependencies from builder
COPY --from=builder /install /usr/local

# Copy app code
COPY api /filesync/api
COPY --chown=nginx:nginx web /filesync/web

# Copy Nginx config
COPY nginx.conf /etc/nginx/http.d/default.conf

# Copy entrypoint script
COPY docker-entrypoint.sh /filesync/docker-entrypoint.sh
RUN chmod +x /filesync/docker-entrypoint.sh

# Health check: verify nginx (at dynamic $PORT or 80) and backend (/health) are both responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO /dev/null http://127.0.0.1:${PORT:-80}/ && wget -qO /dev/null http://127.0.0.1:8000/health

# Expose standard HTTP and Render default container ports
EXPOSE 80 10000

# Run entrypoint script which binds Nginx to $PORT and starts FastAPI
ENTRYPOINT ["/filesync/docker-entrypoint.sh"]
