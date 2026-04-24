#!/bin/sh
set -e

echo "Starting TinyMon Docker entrypoint..."

# Check if data directory exists
if [ ! -d "$DATA_PATH" ]; then
    echo "WARNING: Data directory $DATA_PATH does not exist. Creating..."
    mkdir -p "$DATA_PATH"
fi

# Set permissions for data directory
chown -R nodejs:nodejs "$DATA_PATH" || true
chmod 755 "$DATA_PATH"

# Check for settings.json in data directory
if [ ! -f "$DATA_PATH/settings.json" ]; then
    echo "WARNING: No settings.json found in $DATA_PATH. Creating default configuration..."
    
    # Create default settings.json
    cat > "$DATA_PATH/settings.json" << EOF
{
  "bindAddress": "0.0.0.0",
  "port": 3000,
  "checkInterval": 60,
  "timeout": 5000,
  "retries": 3,
  "logLevel": "info",
  "dateFormat": "en-US",
  "database": {
    "type": "sqlite",
    "sqlite": {
      "path": "$DATA_PATH/monitoring.db"
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
  "users": [
    {
      "username": "admin",
      "password": "\$2a\$10\$YourHashedPasswordHere"
    }
  ],
  "notification_providers": []
}
EOF
    
    echo "Default settings.json created. Please update the password hash before using!"
fi

# Check for settings.d directory
if [ ! -d "$DATA_PATH/settings.d" ]; then
    echo "Creating settings.d directory in $DATA_PATH..."
    mkdir -p "$DATA_PATH/settings.d"
fi

# Update SQLite database path if it's using default path
if [ -f "$DATA_PATH/settings.json" ]; then
    echo "Checking database configuration..."
    
    # Use jq if available to update SQLite path
    if command -v jq >/dev/null 2>&1; then
        # Check if database type is sqlite and path doesn't start with /data
        DB_TYPE=$(jq -r '.database.type // "sqlite"' "$DATA_PATH/settings.json")
        if [ "$DB_TYPE" = "sqlite" ]; then
            SQLITE_PATH=$(jq -r '.database.sqlite.path // "./monitoring.db"' "$DATA_PATH/settings.json")
            if [ "$SQLITE_PATH" != "$DATA_PATH/monitoring.db" ] && [ "$SQLITE_PATH" != "/data/monitoring.db" ]; then
                echo "Updating SQLite database path to $DATA_PATH/monitoring.db"
                jq --arg path "$DATA_PATH/monitoring.db" '.database.sqlite.path = $path' "$DATA_PATH/settings.json" > "$DATA_PATH/settings.json.tmp"
                mv "$DATA_PATH/settings.json.tmp" "$DATA_PATH/settings.json"
            fi
        fi
    else
        echo "NOTE: jq not available, skipping automatic database path update."
        echo "Make sure SQLite database path in settings.json points to $DATA_PATH/monitoring.db"
    fi
fi

# Create symlinks in app directory (already created in Dockerfile, but verify)
if [ ! -L /app/settings.json ]; then
    ln -sf "$DATA_PATH/settings.json" /app/settings.json
fi

if [ ! -L /app/settings.d ]; then
    ln -sf "$DATA_PATH/settings.d" /app/settings.d
fi

# Check if we need to generate password hash
if [ -n "$ADMIN_PASSWORD" ] && [ -f "$DATA_PATH/settings.json" ]; then
    echo "Generating password hash for admin user..."
    if command -v node >/dev/null 2>&1; then
        HASH=$(node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$ADMIN_PASSWORD', 10));")
        if command -v jq >/dev/null 2>&1; then
            jq --arg hash "$HASH" '.users[0].password = $hash' "$DATA_PATH/settings.json" > "$DATA_PATH/settings.json.tmp"
            mv "$DATA_PATH/settings.json.tmp" "$DATA_PATH/settings.json"
            echo "Password hash updated for admin user."
        else
            echo "WARNING: jq not available, cannot update password hash automatically."
            echo "Please manually update the password hash in $DATA_PATH/settings.json"
            echo "Generated hash: $HASH"
        fi
    else
        echo "WARNING: Node.js not available, cannot generate password hash."
    fi
fi

echo "Configuration check complete."
echo "Starting TinyMon..."

# Ensure all files in data directory are owned by nodejs (some may have been created above)
chown -R nodejs:nodejs "$DATA_PATH" || true

# Drop privileges to nodejs user and execute the command
exec su-exec nodejs "$@"