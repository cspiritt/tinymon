# Docker Deployment for TinyMon

This document describes how to deploy TinyMon using Docker.

## Quick Start

### Using Docker Compose (Recommended)

1. **Create data directory:**
   ```bash
   mkdir -p data
   ```

2. **Start TinyMon:**
   ```bash
   docker-compose up -d
   ```

3. **Access the web interface:**
   Open http://localhost:3000 in your browser.

4. **Default credentials:**
   - Username: `admin`
   - Password: `admin` (you should change this immediately)

### Using Docker CLI

1. **Build the image:**
   ```bash
   docker build -t tinymon:latest .
   ```

2. **Create data directory:**
   ```bash
   mkdir -p ./data
   ```

3. **Run the container:**
   ```bash
   docker run -d \
     --name tinymon \
     -p 3000:3000 \
     -v $(pwd)/data:/data \
     -e ADMIN_PASSWORD=your_secure_password \
     tinymon:latest
   ```

## Configuration

### Data Volume

The container uses `/data` volume for:
- `settings.json` - Main configuration file
- `settings.d/` - Directory for service configuration files
- `monitoring.db` - SQLite database file (if using SQLite)

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_PATH` | `/data` | Path to data directory inside container |
| `PORT` | `3000` | Port to listen on |
| `BIND_ADDRESS` | `0.0.0.0` | Address to bind to |
| `ADMIN_PASSWORD` | (none) | Optional: Set admin password on first run |
| `NODE_ENV` | `production` | Node.js environment |

### Setting Admin Password

You can set the admin password in two ways:

1. **Using environment variable:**
   ```bash
   docker run -e ADMIN_PASSWORD=your_password ...
   ```

2. **Manually editing settings.json:**
   Generate a bcrypt hash with the helper script:
   ```bash
   # Interactive mode — password hidden, not stored in shell history
   node scripts/hash-password.js

   # Or pipe from stdin (e.g., from a password manager)
   echo "your_password" | node scripts/hash-password.js
   ```
   Copy the output hash and update the `password` field in `settings.json`.

### Database Configuration

By default, TinyMon uses SQLite with database file at `/data/monitoring.db`.

To use PostgreSQL or MySQL:

1. Update `settings.json` in your data directory
2. Set `database.type` to `"postgres"` or `"mysql"`
3. Configure connection details

Example PostgreSQL configuration:
```json
{
  "database": {
    "type": "postgres",
    "postgres": {
      "host": "postgres",
      "port": 5432,
      "database": "tinymon",
      "user": "tinymon",
      "password": "your_password"
    }
  }
}
```

## Docker Compose Examples

### Basic Setup (SQLite)

```yaml
version: '3.8'
services:
  tinymon:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - ADMIN_PASSWORD=your_secure_password
```

### With PostgreSQL

```yaml
version: '3.8'
services:
  tinymon:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - ADMIN_PASSWORD=your_secure_password
    depends_on:
      - postgres
    networks:
      - tinymon-network

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: tinymon
      POSTGRES_USER: tinymon
      POSTGRES_PASSWORD: your_postgres_password
    volumes:
      - ./postgres-data:/var/lib/postgresql/data
    networks:
      - tinymon-network

networks:
  tinymon-network:
    driver: bridge
```

## Building from Source

### Development Build

```bash
# Clone repository
git clone <repository-url>
cd tinymon

# Build Docker image
docker build -t tinymon:dev .

# Run with development settings
docker run -p 3000:3000 -v $(pwd)/data:/data tinymon:dev
```

### Production Build

The Dockerfile uses multi-stage build:
1. Builder stage installs all dependencies and builds the project
2. Production stage installs only production dependencies

## Export / Import Built Image

You can transfer the built Docker image to another server without a public registry using `docker save` and `docker load`.

### Export Image

On the machine where the image was built:

```bash
# Save the image as a tar archive
docker save tinymon:latest -o tinymon.tar

# Compress (reduces size from ~320MB to ~100MB)
gzip tinymon.tar

# Check the result
ls -lh tinymon.tar.gz
```

### Transfer to Target Server

Use any file transfer method:

```bash
# Via SCP
scp tinymon.tar.gz user@target-server:/tmp/

# Via RSync
rsync -avz tinymon.tar.gz user@target-server:/tmp/

# Via SFTP
sftp user@target-server
> put tinymon.tar.gz /tmp/
```

### Import Image

On the target server:

```bash
# Decompress
gunzip /tmp/tinymon.tar.gz

# Load the image into Docker
docker load -i /tmp/tinymon.tar

# Verify the image loaded
docker images | grep tinymon

# Run the container
docker run -d \
  --name tinymon \
  -p 3000:3000 \
  -v /path/to/data:/data \
  tinymon:latest
```

All-in-one import without intermediate files (streaming):

```bash
# On target server, pipe decompressed archive directly to docker load
gunzip -c /tmp/tinymon.tar.gz | docker load
```

### Complete Example (Build, Export, Deploy)

```bash
# === On build machine ===

# Build the image
docker build -t tinymon:latest .

# Prepare data directory with config
mkdir -p ~/tinymon-data/settings.d
cp settings.json ~/tinymon-data/

# Export and compress image
docker save tinymon:latest | gzip > tinymon.tar.gz

# Copy image and data to target server
scp tinymon.tar.gz user@target-server:/tmp/
scp -r ~/tinymon-data user@target-server:/tmp/tinymon-data


# === On target server ===

# Load the image
gunzip -c /tmp/tinymon.tar.gz | docker load

# Run the container
docker run -d \
  --name tinymon \
  -p 3000:3000 \
  -v /tmp/tinymon-data:/data \
  tinymon:latest
```

## Health Checks

The container includes a health check that verifies the API is responding:
- Checks `/api/status` endpoint every 30 seconds
- Timeout: 3 seconds
- Retries: 3 times
- Start period: 5 seconds

## Troubleshooting

### Container fails to start

1. **Check logs:**
   ```bash
   docker logs tinymon
   ```

2. **Verify data directory permissions:**
   ```bash
   chmod 755 ./data
   ```

3. **Check settings.json syntax:**
   ```bash
   jq . ./data/settings.json
   ```

### Database connection issues

1. **SQLite:**
   - Ensure `/data` volume is mounted correctly
   - Check file permissions: `chmod 666 ./data/monitoring.db`

2. **PostgreSQL/MySQL:**
   - Verify network connectivity between containers
   - Check database credentials in `settings.json`
   - Ensure database is initialized

### Admin password not working

1. **Regenerate password hash:**
   ```bash
   docker exec -it tinymon node scripts/hash-password.js
   ```

2. **Update settings.json:**
   Copy the hash and update the `password` field for the admin user.

## Security Considerations

1. **Change default password:** Always set a strong admin password
2. **Use HTTPS:** Configure reverse proxy with SSL/TLS
3. **Network isolation:** Use Docker networks to isolate containers
4. **Regular updates:** Keep the Docker image updated
5. **Backup data:** Regularly backup the `/data` volume

## Backup and Restore

### Backup

```bash
# Backup data directory
tar -czf tinymon-backup-$(date +%Y%m%d).tar.gz ./data/

# Backup database (SQLite)
sqlite3 ./data/monitoring.db ".backup ./data/monitoring.backup.db"
```

### Restore

```bash
# Restore data directory
tar -xzf tinymon-backup.tar.gz

# Restore container with existing data
docker run -v $(pwd)/data:/data tinymon:latest
```