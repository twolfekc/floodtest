# FloodTest

**ISP Throttle Detection Tool** — Saturates your WAN connection in both directions to detect if your ISP throttles after sustained heavy usage.

## Install (Ubuntu)

```bash
curl -fsSL https://raw.githubusercontent.com/twolfekc/floodtest/main/install.sh | sudo bash
```

This installs Docker (if needed) and starts FloodTest on port **7860**. Open `http://your-server:7860` to configure.

## Update

```bash
curl -fsSL https://raw.githubusercontent.com/twolfekc/floodtest/main/update.sh | sudo bash
```

Pulls the latest image and restarts the container. Your settings, schedules, and history are preserved.

## Manual Install

If you already have Docker and Docker Compose:

```bash
mkdir -p /opt/floodtest && cd /opt/floodtest
```

Create a `docker-compose.yml`:

```yaml
services:
  floodtest:
    image: ghcr.io/twolfekc/floodtest:latest
    container_name: floodtest
    restart: unless-stopped
    ports:
      - "7860:7860"
    volumes:
      - floodtest-data:/data
    environment:
      - DATA_DIR=/data

volumes:
  floodtest-data:
```

Then start it:

```bash
docker compose up -d
```

Open http://localhost:7860 in your browser. The setup wizard will walk you through configuration.

## GitHub Container Registry

The FloodTest Docker image is published to GitHub Container Registry:

```
ghcr.io/twolfekc/floodtest:latest
```

Multi-architecture builds are available for `linux/amd64` and `linux/arm64`.

## Features

- **Download saturation**: Parallel downloads from 22+ geographically diverse speed test servers (Hetzner, Vultr, OVH, CacheFly, and more) with automatic rotation and failover
- **Upload saturation**: Parallel uploads to Backblaze B2 (free ingress, objects deleted immediately)
- **Real-time dashboard**: Live throughput gauges, server health monitoring, cumulative usage counters
- **Historical charts**: Throughput over time with 90 days of retention
- **Throttle detection**: Automatic detection and logging when throughput drops below target thresholds
- **Server health**: Real-time visibility into which download servers are healthy, blocked, or in cooldown — with exponential backoff and automatic recovery
- **Scheduler**: Schedule saturation runs by day/time with configurable speed targets
- **Rate limiting**: Configurable bandwidth targets with token bucket rate limiting per stream
- **Self-contained**: Single Docker container (23MB), no external dependencies

## Backblaze B2 Setup

FloodTest uses Backblaze B2 for uploads because ingress is free and unlimited:

1. Create a [Backblaze B2 account](https://www.backblaze.com/b2/sign-up.html) (free)
2. Create a bucket:
   - Go to **Buckets** → **Create a Bucket**
   - Name it something like `floodtest-uploads`
   - Set to **Private**
3. Create an Application Key:
   - Go to **Application Keys** → **Add a New Application Key**
   - Restrict it to the bucket you created
   - Save the **keyID** and **applicationKey** (shown only once)
4. Enter these credentials in the FloodTest setup wizard

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `B2_KEY_ID` | | Backblaze B2 application key ID |
| `B2_APP_KEY` | | Backblaze B2 application key |
| `B2_BUCKET_NAME` | | B2 bucket name |
| `B2_ENDPOINT` | `https://s3.us-west-004.backblazeb2.com` | B2 S3-compatible endpoint |
| `WEB_PORT` | `7860` | Web UI port |
| `DEFAULT_DOWNLOAD_SPEED` | `5000` | Default download target (Mbps) |
| `DEFAULT_UPLOAD_SPEED` | `5000` | Default upload target (Mbps) |

## How It Works

### Download Engine
Downloads large files (1-10GB) from 22+ public speed test servers in parallel, discarding data to `/dev/null`. Automatically rotates between servers with exponential backoff when one fails or blocks.

### Upload Engine
Generates random data in memory and uploads to B2 via the S3-compatible API. Each object is deleted immediately after upload, keeping storage at ~0. Uses `io.Pipe` for zero-copy streaming.

### Throttle Detection
Monitors rolling average throughput. When it drops below a configurable percentage (default 60%) of the target speed for more than 5 minutes, it logs a throttle event with timestamps and duration.

### Server Health
Each download server is independently tracked for health. Failed connections trigger exponential backoff (5min → 10min → 20min → 30min cap). The dashboard shows real-time server status so you can see which servers are blocked by your ISP.

## Architecture

Single Go binary with embedded React frontend in a 23MB distroless Docker container.

- **Backend**: Go with goroutines for high-concurrency streaming
- **Frontend**: React + TypeScript + Tailwind CSS + Recharts
- **Database**: SQLite (persisted in Docker volume)
- **Real-time**: WebSocket for live stats push

## Unraid Setup

1. Add the container via Docker Compose or Unraid's Docker UI
2. Map port 7860
3. Create a path mapping for `/data` to persist settings and history
4. Configure through the web UI setup wizard

## License

MIT
