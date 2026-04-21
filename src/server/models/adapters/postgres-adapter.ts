import { DatabaseAdapter, UpdateServiceStatusResult } from '../database-adapter';
import { Service, DatabaseConfig } from '../../types';
import { dbLogger } from '../../utils/logger';

interface PGModule {
  Pool: new (config: any) => any;
}

export class PostgresAdapter extends DatabaseAdapter {
  private pg: PGModule | null = null;
  private pool: any = null;

  constructor(config: DatabaseConfig['postgres']) {
    super({ type: 'postgres', sqlite: {} as any, postgres: config, mysql: {} as any });
  }

  async connect(): Promise<void> {
    try {
      this.pg = require('pg');
    } catch (err) {
      throw new Error(
        'Модуль pg (node-postgres) не установлен. Установите его: npm install pg'
      );
    }

    const { host, port, database, user, password } = this.config.postgres;

    this.pool = new this.pg!.Pool({
      host: host || 'localhost',
      port: port || 5432,
      database: database || 'tinymon',
      user: user || 'postgres',
      password: password || '',
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    // Проверяем соединение
    const client = await this.pool.connect();
    try {
      await this.createTables();
      dbLogger.info('PostgreSQL база данных подключена');
    } finally {
      client.release();
    }
  }

  async createTables(): Promise<void> {
    const client = await this.pool!.connect();
    try {
      // Таблица сервисов
      await client.query(`
        CREATE TABLE IF NOT EXISTS services (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('ip', 'http', 'ssl')),
          address TEXT NOT NULL,
          interval INTEGER NOT NULL,
          timeout INTEGER DEFAULT 5000,
          failure_count INTEGER DEFAULT 0,
          last_status TEXT DEFAULT 'unknown',
          last_check BIGINT DEFAULT 0,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
          service_group TEXT DEFAULT '',
          warn_before INTEGER DEFAULT NULL,
          check_at TEXT DEFAULT NULL,
          ssl_days_until_expiry INTEGER DEFAULT NULL,
          ssl_expiry_date BIGINT DEFAULT NULL,
          last_notified_status TEXT DEFAULT 'unknown'
        )
      `);
      
      // Миграция: добавить колонку service_group если отсутствует
      await client.query(`
        ALTER TABLE services ADD COLUMN IF NOT EXISTS service_group TEXT DEFAULT ''
      `);
      
      // Миграция для SSL полей
      await client.query(`
        ALTER TABLE services ADD COLUMN IF NOT EXISTS warn_before INTEGER DEFAULT NULL
      `);
      
      await client.query(`
        ALTER TABLE services ADD COLUMN IF NOT EXISTS check_at TEXT DEFAULT NULL
      `);
      
      await client.query(`
        ALTER TABLE services ADD COLUMN IF NOT EXISTS ssl_days_until_expiry INTEGER DEFAULT NULL
      `);
      
      await client.query(`
        ALTER TABLE services ADD COLUMN IF NOT EXISTS ssl_expiry_date BIGINT DEFAULT NULL
      `);

      await client.query(`
        ALTER TABLE services ADD COLUMN IF NOT EXISTS last_notified_status TEXT DEFAULT 'unknown'
      `);

      // Таблица результатов проверок
      await client.query(`
        CREATE TABLE IF NOT EXISTS checks (
          id SERIAL PRIMARY KEY,
          service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
          response_time INTEGER,
          error_message TEXT,
          checked_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
        )
      `);

      // Индексы
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_checks_service_id ON checks(service_id);
        CREATE INDEX IF NOT EXISTS idx_checks_checked_at ON checks(checked_at);
      `);

      // Таблица подписчиков на уведомления
      await client.query(`
        CREATE TABLE IF NOT EXISTS notification_subscribers (
          id SERIAL PRIMARY KEY,
          provider_id TEXT NOT NULL,
          subscriber_id TEXT NOT NULL,
          data TEXT DEFAULT '{}',
          subscribed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
          is_active BOOLEAN DEFAULT true,
          UNIQUE(provider_id, subscriber_id)
        )
      `);
    } finally {
      client.release();
    }
  }

  async syncServices(services: Service[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const service of services) {
        await client.query(`
          INSERT INTO services (id, name, type, address, interval, timeout, service_group, warn_before, check_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            type = EXCLUDED.type,
            address = EXCLUDED.address,
            interval = EXCLUDED.interval,
            timeout = EXCLUDED.timeout,
            service_group = EXCLUDED.service_group,
            warn_before = EXCLUDED.warn_before,
            check_at = EXCLUDED.check_at
        `, [
          service.id,
          service.name,
          service.type,
          service.address,
          service.interval,
          service.timeout || 5000,
          service.group || '',
          service.warn_before !== undefined ? service.warn_before : null,
          service.check_at || null
        ]);
      }

      await client.query('COMMIT');
      dbLogger.info(`PostgreSQL: синхронизировано сервисов: ${services.length}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getAllServices(): Promise<any[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT *, service_group AS "group" FROM services ORDER BY service_group, name');
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getService(id: string): Promise<any> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT *, service_group AS "group" FROM services WHERE id = $1', [id]);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Получаем текущий сервис
      const serviceResult = await client.query(
        'SELECT failure_count FROM services WHERE id = $1',
        [serviceId]
      );

      if (serviceResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error(`Сервис ${serviceId} не найден`);
      }

      let failureCount = serviceResult.rows[0].failure_count;
      let lastStatus = 'unknown';

      if (success) {
        failureCount = 0;
        lastStatus = 'success';
      } else {
        failureCount += 1;
        lastStatus = 'failure';
      }

      // Подготавливаем значения SSL полей
      const sslDaysUntilExpiry = options?.ssl_days_until_expiry !== undefined ? options.ssl_days_until_expiry : null;
      const sslExpiryDate = options?.ssl_expiry_date ? Math.floor(options.ssl_expiry_date.getTime() / 1000) : null;
      
      // Обновляем сервис
      await client.query(`
        UPDATE services
        SET failure_count = $1, last_status = $2, last_check = EXTRACT(EPOCH FROM NOW()),
            ssl_days_until_expiry = $4, ssl_expiry_date = $5
        WHERE id = $3
      `, [failureCount, lastStatus, serviceId, sslDaysUntilExpiry, sslExpiryDate]);

      // Записываем результат проверки
      await client.query(`
        INSERT INTO checks (service_id, status, response_time, error_message)
        VALUES ($1, $2, $3, $4)
      `, [
        serviceId,
        success ? 'success' : 'failure',
        responseTime,
        errorMessage
      ]);

      await client.query('COMMIT');
      return { failureCount, lastStatus: lastStatus as any };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getServiceChecks(serviceId: string, limit: number = 10): Promise<any[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT * FROM checks
        WHERE service_id = $1
        ORDER BY checked_at DESC
        LIMIT $2
      `, [serviceId, limit]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getStats(periodHours: number = 24): Promise<any> {
    const client = await this.pool.connect();
    try {
      const since = Math.floor(Date.now() / 1000) - (periodHours * 3600);
      const result = await client.query(`
        SELECT
          service_id,
          COUNT(*) as total_checks,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
          AVG(response_time) as avg_response_time
        FROM checks
        WHERE checked_at > $1
        GROUP BY service_id
      `, [since]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getServiceLastNotifiedStatus(serviceId: string): Promise<string> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT last_notified_status FROM services WHERE id = $1', [serviceId]);
      return result.rows[0]?.last_notified_status || 'unknown';
    } finally {
      client.release();
    }
  }

  async updateServiceLastNotifiedStatus(serviceId: string, status: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('UPDATE services SET last_notified_status = $1 WHERE id = $2', [status, serviceId]);
    } finally {
      client.release();
    }
  }

  async addNotificationSubscriber(providerId: string, subscriberId: string, data?: any): Promise<void> {
    const client = await this.pool.connect();
    try {
      const dataStr = data ? JSON.stringify(data) : '{}';
      await client.query(`
        INSERT INTO notification_subscribers (provider_id, subscriber_id, data, is_active, subscribed_at)
        VALUES ($1, $2, $3, true, EXTRACT(EPOCH FROM NOW()))
        ON CONFLICT (provider_id, subscriber_id) DO UPDATE SET
          data = EXCLUDED.data,
          is_active = true,
          subscribed_at = EXCLUDED.subscribed_at
      `, [providerId, subscriberId, dataStr]);
    } finally {
      client.release();
    }
  }

  async removeNotificationSubscriber(providerId: string, subscriberId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        UPDATE notification_subscribers SET is_active = false WHERE provider_id = $1 AND subscriber_id = $2
      `, [providerId, subscriberId]);
    } finally {
      client.release();
    }
  }

  async getNotificationSubscribers(providerId: string): Promise<any[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT subscriber_id, data, subscribed_at FROM notification_subscribers 
        WHERE provider_id = $1 AND is_active = true
      `, [providerId]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }
}