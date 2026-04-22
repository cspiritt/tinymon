import { DatabaseAdapter, UpdateServiceStatusResult } from '../database-adapter';
import { Service, DatabaseConfig } from '../../types';
import { dbLogger } from '../../utils/logger';

interface SQLiteDatabase {
  new (path: string): any;
  pragma: (setting: string) => void;
  exec: (sql: string) => void;
  prepare: (sql: string) => any;
  transaction: (fn: (services: Service[]) => void) => (services: Service[]) => void;
  close: () => void;
}

export class SQLiteAdapter extends DatabaseAdapter {
  private Database: SQLiteDatabase | null = null;

  constructor(config: DatabaseConfig['sqlite']) {
    super({ type: 'sqlite', sqlite: config, postgres: {} as any, mysql: {} as any });
  }

  async connect(): Promise<void> {
    // Dynamic import of better-sqlite3
    try {
      this.Database = require('better-sqlite3');
    } catch (err) {
      throw new Error(
        'better-sqlite3 module is not installed. Install it: npm install better-sqlite3'
      );
    }

    const dbPath = this.config.sqlite.path || './monitoring.db';
    this.db = new this.Database!(dbPath);
    this.db.pragma('journal_mode = WAL');

    await this.createTables();
    dbLogger.info(`SQLite database connected: ${dbPath}`);
  }

  async createTables(): Promise<void> {
    // Services table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('ip', 'http', 'ssl')),
        address TEXT NOT NULL,
        interval INTEGER NOT NULL,
        timeout INTEGER DEFAULT 5000,
        failure_count INTEGER DEFAULT 0,
        last_status TEXT DEFAULT 'unknown',
        last_check INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        service_group TEXT DEFAULT '',
        warn_before INTEGER DEFAULT NULL,
        check_at TEXT DEFAULT NULL,
        ssl_days_until_expiry INTEGER DEFAULT NULL,
        ssl_expiry_date INTEGER DEFAULT NULL,
        last_notified_status TEXT DEFAULT 'unknown'
      )
    `);

    // Check results table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
        response_time INTEGER,
        error_message TEXT,
        checked_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
      )
    `);

    // Notification subscribers table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notification_subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT NOT NULL,
        subscriber_id TEXT NOT NULL,
        data TEXT DEFAULT '{}',
        subscribed_at INTEGER DEFAULT (strftime('%s', 'now')),
        is_active INTEGER DEFAULT 1,
        UNIQUE(provider_id, subscriber_id)
      )
    `);

    // Indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_checks_service_id ON checks(service_id);
      CREATE INDEX IF NOT EXISTS idx_checks_checked_at ON checks(checked_at);
    `);

    // Migration for existing tables (add service_group column if missing)
    try {
      this.db.exec(`ALTER TABLE services ADD COLUMN service_group TEXT DEFAULT ''`);
      dbLogger.info('Migration: added service_group column');
    } catch (err) {
      // Column already exists, ignore error
    }
    
    // Migration for SSL fields
    try {
      this.db.exec(`ALTER TABLE services ADD COLUMN warn_before INTEGER DEFAULT NULL`);
      dbLogger.info('Migration: added warn_before column');
    } catch (err) {
      // Column already exists, ignore error
    }
    
    try {
      this.db.exec(`ALTER TABLE services ADD COLUMN check_at TEXT DEFAULT NULL`);
      dbLogger.info('Migration: added check_at column');
    } catch (err) {
      // Column already exists, ignore error
    }
    
    try {
      this.db.exec(`ALTER TABLE services ADD COLUMN ssl_days_until_expiry INTEGER DEFAULT NULL`);
      dbLogger.info('Migration: added ssl_days_until_expiry column');
    } catch (err) {
      // Column already exists, ignore error
    }
    
    try {
      this.db.exec(`ALTER TABLE services ADD COLUMN ssl_expiry_date INTEGER DEFAULT NULL`);
      dbLogger.info('Migration: added ssl_expiry_date column');
    } catch (err) {
      // Column already exists, ignore error
    }
    
    try {
      this.db.exec(`ALTER TABLE services ADD COLUMN last_notified_status TEXT DEFAULT 'unknown'`);
      dbLogger.info('Migration: added last_notified_status column');
    } catch (err) {
      // Column already exists, ignore error
    }
    
    // Type migration: cannot update CHECK constraint directly, need to recreate table
    // But can simply ignore, because SQLite doesn't check CHECK on ALTER TABLE
    // Only new services need to be updated, old ones will continue working
  }

  async syncServices(services: Service[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO services (id, name, type, address, interval, timeout, service_group, warn_before, check_at)
      VALUES (@id, @name, @type, @address, @interval, @timeout, @service_group, @warn_before, @check_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        address = excluded.address,
        interval = excluded.interval,
        timeout = excluded.timeout,
        service_group = excluded.service_group,
        warn_before = excluded.warn_before,
        check_at = excluded.check_at
    `);

    const transaction = this.db.transaction((services: Service[]) => {
      for (const service of services) {
        stmt.run({
          id: service.id,
          name: service.name,
          type: service.type,
          address: service.address,
          interval: service.interval,
          timeout: service.timeout || 5000,
          service_group: service.group || '',
          warn_before: service.warn_before !== undefined ? service.warn_before : null,
          check_at: service.check_at || null
        });
      }
    });

    transaction(services);
    dbLogger.info(`SQLite: synchronized services: ${services.length}`);
  }

  async getAllServices(): Promise<any[]> {
    return this.db.prepare('SELECT *, service_group AS "group" FROM services ORDER BY service_group, name').all();
  }

  async getService(id: string): Promise<any> {
    return this.db.prepare('SELECT *, service_group AS "group" FROM services WHERE id = ?').get(id);
  }

  async updateServiceStatus(
    serviceId: string,
    success: boolean,
    responseTime: number | null = null,
    errorMessage: string | null = null,
    options?: {
      ssl_days_until_expiry?: number;
      ssl_expiry_date?: Date;
    }
  ): Promise<UpdateServiceStatusResult> {
    const service = await this.getService(serviceId);
    if (!service) {
      throw new Error(`Service ${serviceId} not found`);
    }

    let failureCount = service.failure_count;
    let lastStatus = 'unknown';

    if (success) {
      failureCount = 0;
      lastStatus = 'success';
    } else {
      failureCount += 1;
      lastStatus = 'failure';
    }

    // Prepare SSL field values
    const sslDaysUntilExpiry = options?.ssl_days_until_expiry !== undefined ? options.ssl_days_until_expiry : null;
    const sslExpiryDate = options?.ssl_expiry_date ? Math.floor(options.ssl_expiry_date.getTime() / 1000) : null;
    
    const stmt = this.db.prepare(`
      UPDATE services
      SET failure_count = ?, last_status = ?, last_check = strftime('%s', 'now'),
          ssl_days_until_expiry = ?, ssl_expiry_date = ?
      WHERE id = ?
    `);
    stmt.run(failureCount, lastStatus, sslDaysUntilExpiry, sslExpiryDate, serviceId);

    // Record check result in history
    const checkStmt = this.db.prepare(`
      INSERT INTO checks (service_id, status, response_time, error_message)
      VALUES (?, ?, ?, ?)
    `);
    checkStmt.run(
      serviceId,
      success ? 'success' : 'failure',
      responseTime,
      errorMessage
    );

    return { failureCount, lastStatus: lastStatus as any };
  }

  async getServiceChecks(serviceId: string, limit: number = 10): Promise<any[]> {
    return this.db.prepare(`
      SELECT * FROM checks
      WHERE service_id = ?
      ORDER BY checked_at DESC
      LIMIT ?
    `).all(serviceId, limit);
  }

  async getStats(periodHours: number = 24): Promise<any> {
    const since = Math.floor(Date.now() / 1000) - (periodHours * 3600);
    return this.db.prepare(`
      SELECT
        service_id,
        COUNT(*) as total_checks,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        AVG(response_time) as avg_response_time
      FROM checks
      WHERE checked_at > ?
      GROUP BY service_id
    `).all(since);
  }

  async getServiceLastNotifiedStatus(serviceId: string): Promise<string> {
    const result = this.db.prepare('SELECT last_notified_status FROM services WHERE id = ?').get(serviceId);
    return result ? result.last_notified_status : 'unknown';
  }

  async updateServiceLastNotifiedStatus(serviceId: string, status: string): Promise<void> {
    this.db.prepare('UPDATE services SET last_notified_status = ? WHERE id = ?').run(status, serviceId);
  }

  async addNotificationSubscriber(providerId: string, subscriberId: string, data?: any): Promise<void> {
    const dataStr = data ? JSON.stringify(data) : '{}';
    this.db.prepare(`
      INSERT OR REPLACE INTO notification_subscribers (provider_id, subscriber_id, data, is_active, subscribed_at)
      VALUES (?, ?, ?, 1, strftime('%s', 'now'))
    `).run(providerId, subscriberId, dataStr);
  }

  async removeNotificationSubscriber(providerId: string, subscriberId: string): Promise<void> {
    this.db.prepare(`
      UPDATE notification_subscribers SET is_active = 0 WHERE provider_id = ? AND subscriber_id = ?
    `).run(providerId, subscriberId);
  }

  async getNotificationSubscribers(providerId: string): Promise<any[]> {
    return this.db.prepare(`
      SELECT subscriber_id, data, subscribed_at FROM notification_subscribers 
      WHERE provider_id = ? AND is_active = 1
    `).all(providerId);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
  }
}