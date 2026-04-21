import { DatabaseAdapter, UpdateServiceStatusResult } from '../database-adapter';
import { Service, DatabaseConfig } from '../../types';

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
    // Динамический импорт better-sqlite3
    try {
      this.Database = require('better-sqlite3');
    } catch (err) {
      throw new Error(
        'Модуль better-sqlite3 не установлен. Установите его: npm install better-sqlite3'
      );
    }

    const dbPath = this.config.sqlite.path || './monitoring.db';
    this.db = new this.Database!(dbPath);
    this.db.pragma('journal_mode = WAL');

    await this.createTables();
    console.log(`SQLite база данных подключена: ${dbPath}`);
  }

  async createTables(): Promise<void> {
    // Таблица сервисов
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('ip', 'http')),
        address TEXT NOT NULL,
        interval INTEGER NOT NULL,
        timeout INTEGER DEFAULT 5000,
        failure_count INTEGER DEFAULT 0,
        last_status TEXT DEFAULT 'unknown',
        last_check INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Таблица результатов проверок
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

    // Индексы
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_checks_service_id ON checks(service_id);
      CREATE INDEX IF NOT EXISTS idx_checks_checked_at ON checks(checked_at);
    `);
  }

  async syncServices(services: Service[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO services (id, name, type, address, interval, timeout)
      VALUES (@id, @name, @type, @address, @interval, @timeout)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        address = excluded.address,
        interval = excluded.interval,
        timeout = excluded.timeout
    `);

    const transaction = this.db.transaction((services: Service[]) => {
      for (const service of services) {
        stmt.run({
          id: service.id,
          name: service.name,
          type: service.type,
          address: service.address,
          interval: service.interval,
          timeout: service.timeout || 5000
        });
      }
    });

    transaction(services);
    console.log(`SQLite: синхронизировано сервисов: ${services.length}`);
  }

  async getAllServices(): Promise<any[]> {
    return this.db.prepare('SELECT * FROM services ORDER BY name').all();
  }

  async getService(id: string): Promise<any> {
    return this.db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  }

  async updateServiceStatus(
    serviceId: string,
    success: boolean,
    responseTime: number | null = null,
    errorMessage: string | null = null
  ): Promise<UpdateServiceStatusResult> {
    const service = await this.getService(serviceId);
    if (!service) {
      throw new Error(`Сервис ${serviceId} не найден`);
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

    const stmt = this.db.prepare(`
      UPDATE services
      SET failure_count = ?, last_status = ?, last_check = strftime('%s', 'now')
      WHERE id = ?
    `);
    stmt.run(failureCount, lastStatus, serviceId);

    // Записать результат проверки в историю
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

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
  }
}