# TinyMon

Lightweight service availability monitoring for IP/HTTP/HTTPS resources built on Node.js.

## Features

- HTTP/HTTPS resource monitoring (GET requests)
- IP address monitoring (ICMP ping)
- **SSL certificate expiration monitoring** with configurable warning thresholds
- Flexible configuration via JSON files
- Automatic periodic checks
- Check history stored in SQLite database
- Web interface for status viewing
- REST API for integration
- **Telegram notifications** for status changes and SSL certificate warnings
- Automatic status determination: OK, WARNING, ERROR
- **Offline support**: All external resources (fonts, icons) are bundled locally
- **Full English localization**: User interface, error messages, logs, and comments

## Requirements

- Node.js 22 or higher
- npm or yarn
- Network access for checks
- For ping checks, ICMP execution privileges are required (usually requires root or appropriate capabilities)

## Installation

```bash
# Clone repository (if applicable)
git clone <repository-url>
cd tinymon

# Install dependencies
npm install
```

## Configuration

### Main Settings (settings.json)

Create a `settings.json` file in the project root:

```json
{
  "bindAddress": "0.0.0.0",
  "port": 3000,
  "checkInterval": 60,
  "timeout": 5000,
  "retries": 3,
  "logLevel": "info",
  "database": {
    "type": "sqlite",
    "sqlite": {
      "path": "./monitoring.db"
    },
    "postgres": {
      "host": "localhost",
      "port": 5432,
      "database": "tinymon",
      "user": "postgres",
      "password": ""
    },
    "mysql": {
      "host": "localhost",
      "port": 3306,
      "database": "tinymon",
      "user": "root",
      "password": ""
    }
  },
  "notification_providers": [
    {
      "id": "telegram-bot",
      "type": "telegram",
      "parameters": {
        "token": "YOUR_BOT_TOKEN",
        "allowed_subscribers": [123456789]
      }
    }
  ],
  "users": [
    {
      "user": "admin",
      "password": "$2b$10$hashed_password_here"
    }
  ]
}
```

- `bindAddress` - IP address to listen on
- `port` - port for web server
- `checkInterval` - base check interval in seconds
- `timeout` - check timeout in milliseconds
- `retries` - number of retry attempts on failure
- `logLevel` - logging level (error, warn, info, debug)
- `database` - database configuration (type and connection parameters)
- `notification_providers` - array of notification providers (Telegram, etc.)
- `users` - array of user accounts for web interface authentication

**Note:** User passwords must be bcrypt hashed. You can generate a hash using the `bcryptjs` package or online tools. The default admin password hash in the example corresponds to the password "admin".

### Service Configuration (settings.d)

Create a `settings.d` folder and add JSON files for each monitored service.

Example for HTTP service (`settings.d/google.json`):

```json
{
  "name": "Google HTTP",
  "type": "http",
  "address": "https://www.google.com",
  "interval": 30,
  "timeout": 3000
}
```

Example for IP service (`settings.d/cloudflare-dns.json`):

```json
{
  "name": "Cloudflare DNS",
  "type": "ip",
  "address": "1.1.1.1",
  "interval": 60,
  "timeout": 2000
}
```

Parameters:
- `name` - display name of the service
- `type` - check type: `http`, `ip`, or `ssl`
- `address` - URL for HTTP/SSL or IP address for ping
- `interval` - check interval in seconds (minimum 10)
- `timeout` - check timeout in milliseconds (optional)

### SSL Certificate Monitoring

TinyMon can monitor SSL certificate expiration dates for HTTPS services. SSL checks include:

- Certificate validity period checking
- Configurable warning threshold before expiration
- Scheduled checks at specific times of day
- Integration with notification system for warnings

Example SSL check configuration (`settings.d/github-ssl.json`):

```json
{
  "name": "GitHub SSL",
  "type": "ssl",
  "address": "https://github.com",
  "interval": 86400,
  "warn_before": 30,
  "check_at": "08:00",
  "group": "SSL Certificates"
}
```

Additional SSL-specific parameters:
- `warn_before` - number of days before expiration to trigger WARNING status (default: 30)
- `check_at` - optional time of day to perform checks (format: "HH:MM" in 24-hour format)

SSL Status Logic:
- **OK**: Certificate valid for more than `warn_before` days
- **WARNING**: Certificate expires within `warn_before` days
- **ERROR**: Certificate has expired

## Logging

TinyMon uses a centralized logging system with date and time support including milliseconds.

### Log Format

All logs are output in the format:
```
[YYYY-MM-DD HH:MM:SS.mmm] [LEVEL] [Prefix] message
```

Example:
```
[2026-04-21 21:41:18.222] [DEBUG] [Scheduler] Starting check scheduler...
```

### Log Levels

Log levels (in priority order from lowest to highest):
1. **ERROR** - critical errors requiring immediate attention
2. **WARN** - warnings, potential issues
3. **INFO** - informational messages (default level)
4. **DEBUG** - debug information for development

### Configuration

Log level is configured in `settings.json` via the `logLevel` parameter:
```json
{
  "logLevel": "info"
}
```

Available values: `"error"`, `"warn"`, `"info"`, `"debug"`.

### Module Loggers

The system provides ready-to-use loggers for various modules:
- `Main` - main server process
- `DB` - database operations
- `Checker` - service checks
- `Scheduler` - check scheduler (DEBUG level messages)
- `Notification` - notifications (Telegram bot)
- `Config` - configuration loading
- `Routes` - HTTP request handling

**Note:** Messages from the scheduler (Scheduler) have DEBUG level to reduce log noise during normal operation.

## Running

### Development (with auto-reload)

```bash
npm run dev:ts
```

### Production

```bash
npm start
```

The service will be available at: `http://localhost:3000`

## Web Interface

After starting, open your browser and navigate to `http://localhost:3000`

The interface includes:
- Overall statistics (OK, WARNING, ERROR)
- Table of all services with current status
- Manual check triggering
- View check history for each service
- Automatic refresh every 30 seconds

## REST API

### Get Status of All Services

```
GET /api/status
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "google",
      "name": "Google HTTP",
      "type": "http",
      "address": "https://www.google.com",
      "interval": 30,
      "failureCount": 0,
      "status": "OK",
      "lastCheck": 1776694125,
      "lastStatus": "success",
      "createdAt": 1776694089
    }
  ],
  "timestamp": 1776694126273
}
```

### Get Service Check History

```
GET /api/service/{id}/checks?limit=10
```

### Force Service Check

```
POST /api/service/{id}/check
```

### Get Statistics

```
GET /api/stats?period=24
```

## Status Logic

- **OK**: failure count equals 0
- **WARNING**: failure count from 1 to 2
- **ERROR**: failure count 3 or more

On successful check, the counter resets to 0. On failed check, it increases by 1.

## Notifications

TinyMon supports real-time notifications via Telegram bot for status changes and SSL certificate warnings.

### Telegram Notifications

To enable Telegram notifications, add a notification provider to your `settings.json`:

```json
{
  "notification_providers": [
    {
      "id": "telegram-bot",
      "type": "telegram",
      "parameters": {
        "token": "YOUR_BOT_TOKEN",
        "allowed_subscribers": [123456789]
      }
    }
  ]
}
```

**Parameters:**
- `token` - Telegram Bot API token from [@BotFather](https://t.me/botfather)
- `allowed_subscribers` - array of Telegram user IDs who can subscribe to notifications
- `webhook` (optional) - webhook configuration for production deployments

**Features:**
- Real-time notifications for service status changes (OK → WARNING → ERROR)
- SSL certificate expiration warnings
- Manual check triggers via Telegram commands
- Subscription management for users
- Detailed service information in notifications

**Telegram Commands:**
- `/start` - Start interaction with bot
- `/subscribe` - Subscribe to notifications
- `/unsubscribe` - Unsubscribe from notifications
- `/status` - Get current status of all services
- `/check <service_id>` - Manually trigger service check
- `/help` - Show available commands

### Notification Triggers

Notifications are sent when:
1. Service status changes (OK → WARNING, WARNING → ERROR, etc.)
2. SSL certificate enters warning period (based on `warn_before` setting)
3. SSL certificate expires
4. Manual check is triggered via API or web interface

## Database

Uses SQLite database. The file is created automatically on first run.

Structure:
- `services` - service information and current state
- `checks` - history of all checks

## Offline Support & Localization

TinyMon is designed to work in offline/air-gapped environments:

### Local Assets
- **Font Awesome icons**: Bundled locally via `@fortawesome/fontawesome-free` npm package
- **Inter font**: Bundled locally via `typeface-inter` npm package
- **No external CDN dependencies**: All CSS, fonts, and icons are served from local `public/vendor/` directory

### English Localization
- Complete translation of user interface, error messages, logs, and code comments
- EJS templates use `<html lang="en">`
- Configuration files use English group names
- Build scripts and documentation in English

### Build Process
The `npm run copy:vendor` command automatically copies vendor assets from `node_modules` to `public/vendor/` during build. This is integrated into all build commands.

## Development

### Project Structure

```
tinymon/
├── src/                    # Source code
│   ├── client/            # Client-side TypeScript
│   └── server/            # Server-side TypeScript
│       ├── models/        # Database models
│       ├── routes/        # API routes
│       ├── utils/         # Utility functions
│       ├── views/         # EJS templates
│       └── notifications/ # Notification providers
├── public/                # Static files
│   ├── css/               # Styles
│   ├── js/                # Client JavaScript
│   └── vendor/            # Localized external resources
│       ├── fontawesome/   # Font Awesome CSS and fonts
│       └── inter/         # Inter font files
├── settings.d/            # Service configuration
├── scripts/               # Build utilities
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript configuration
├── webpack.config.js      # Webpack configuration
└── README.md              # Documentation
```

### Adding New Check Types

To add a new check type:
1. Add support for the type in `src/server/utils/checker.ts`
2. Update validation in `src/server/utils/config.ts`
3. Add corresponding icon in the web interface

## Build and Deployment

The project uses Webpack to create a production bundle with all dependencies (except database drivers).

### Supported Databases

TinyMon supports multiple database types through adapter system:

1. **SQLite** (default) - requires `better-sqlite3` installation
2. **PostgreSQL** - requires `pg` installation
3. **MySQL** - requires `mysql2` installation

Database drivers are not included in the bundle and must be installed separately on the target system.

### Build Commands

```bash
# Clean build directory
npm run clean

# Copy vendor assets (fonts, icons) to public/vendor
npm run copy:vendor

# Build project to dist directory (Webpack)
npm run build

# Build client bundle
npm run build:client

# Build all (clean + build + build:client)
npm run build:all

# Legacy build (file copying approach)
npm run build:legacy

# Run production version from dist
npm run start:prod

# Type checking
npm run type-check
npm run type-check:client
```

### Build Structure

After running `npm run build:legacy`, a `dist` directory is created with the following structure:

```
dist/
├── bundle.js             # Main application bundle (all JS code)
├── settings.json         # Main settings
├── settings.d/           # Service configurations
├── views/               # EJS templates
├── public/              # Static files (CSS, JS, vendor assets)
│   ├── css/style.css
│   ├── js/app.js
│   └── vendor/          # Localized external resources
│       ├── fontawesome/
│       └── inter/
├── package.json         # Minimal package.json with peerDependencies
└── README.md            # Documentation
```

### Deployment

To deploy the built version:

1. **Build:** Run `npm run build:legacy`
2. **Copy:** Copy the contents of the `dist` directory to your server
3. **Install DB drivers:** On the server, install the required database driver:
   ```bash
   # For SQLite
   npm install better-sqlite3

   # For PostgreSQL
   npm install pg

   # For MySQL
   npm install mysql2
   ```
4. **Run:** Start the application:
   ```bash
   node bundle.js
   ```

### Database Configuration

Modify `settings.json` to select database type:

```json
{
  "database": {
    "type": "postgres",  // or "sqlite", "mysql"
    "postgres": {
      "host": "localhost",
      "port": 5432,
      "database": "tinymon",
      "user": "postgres",
      "password": "your_password"
    }
  }
}
```

### TCP Ping Instead of ICMP

For IP address checks, TCP ping (connection to port) is used instead of ICMP, which doesn't require special privileges and works on all platforms. Address format: `host:port` (default port 80).

Example IP check configuration:
```json
{
  "name": "Web Server",
  "type": "ip",
  "address": "example.com:443",
  "interval": 30
}
```

## License

MIT