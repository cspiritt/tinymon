import { DatabaseAdapter, UpdateServiceStatusResult } from '../database-adapter';
import { Service, DatabaseConfig } from '../../types';

interface MySQLModule {
  createPool(config: any): any;
}

export class MySQLAdapter extends DatabaseAdapter {
  private mysql: MySQLModule | null = null;
  private pool: any = null;

  constructor(config: DatabaseConfig['mysql']) {
    super({ type: 'mysql', sqlite: {} as any, postgres: {} as any, mysql: config });
  }

  async connect(): Promise<void> {
    try {
      this.mysql = require('mysql2/promise');
    } catch (err) {
      throw new Error(
        'Модуль mysql2 не установлен. Установите его: npm install mysql2'
      );
    }

    const { host, port, database, user, password } = this.config.mysql;

    this.pool = this.mysql!.createPool({
      host: host || 'localhost',
      port: port || 3306,
      database: database || 'tinymon',
      user: user || 'root',
      password: password || '',
      connectionLimit: 10,
      waitForConnections: true,
      queueLimit: 0
    });

    // Проверяем соединение
    const connection = await this.pool.getConnection();
    try {
      await this.createTablesWithConnection(connection);
      console.log('MySQL база данных подключена');
    } finally {
      connection.release();
    }
  }

  async createTables(): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await this.createTablesWithConnection(connection);
    } finally {
      connection.release();
    }
  }

  private async createTablesWithConnection(connection: any): Promise<void> {
    // Таблица сервисов
    await connection.query(`
      CREATE TABLE IF NOT EXISTS services (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type ENUM('ip', 'http', 'ssl') NOT NULL,
        address TEXT NOT NULL,
        interval INT NOT NULL,
        timeout INT DEFAULT 5000,
        failure_count INT DEFAULT 0,
        last_status VARCHAR(50) DEFAULT 'unknown',
        last_check BIGINT DEFAULT 0,
        created_at BIGINT DEFAULT UNIX_TIMESTAMP(),
        service_group VARCHAR(255) DEFAULT '',
        warn_before INT DEFAULT NULL,
        check_at VARCHAR(10) DEFAULT NULL,
        ssl_days_until_expiry INT DEFAULT NULL,
        ssl_expiry_date BIGINT DEFAULT NULL,
        last_notified_status VARCHAR(50) DEFAULT 'unknown'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    // Миграция: добавить колонку service_group если отсутствует
    await connection.query(`
      ALTER TABLE services ADD COLUMN IF NOT EXISTS service_group VARCHAR(255) DEFAULT ''
    `);
    
    // Миграция для SSL полей
    await connection.query(`
      ALTER TABLE services ADD COLUMN IF NOT EXISTS warn_before INT DEFAULT NULL
    `);
    
    await connection.query(`
      ALTER TABLE services ADD COLUMN IF NOT EXISTS check_at VARCHAR(10) DEFAULT NULL
    `);
    
    await connection.query(`
      ALTER TABLE services ADD COLUMN IF NOT EXISTS ssl_days_until_expiry INT DEFAULT NULL
    `);
    
    await connection.query(`
      ALTER TABLE services ADD COLUMN IF NOT EXISTS ssl_expiry_date BIGINT DEFAULT NULL
    `);

    await connection.query(`
      ALTER TABLE services ADD COLUMN IF NOT EXISTS last_notified_status VARCHAR(50) DEFAULT 'unknown'
    `);

    // Таблица результатов проверок
    await connection.query(`
      CREATE TABLE IF NOT EXISTS checks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        service_id VARCHAR(255) NOT NULL,
        status ENUM('success', 'failure') NOT NULL,
        response_time INT,
        error_message TEXT,
        checked_at BIGINT DEFAULT UNIX_TIMESTAMP(),
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
        INDEX idx_checks_service_id (service_id),
        INDEX idx_checks_checked_at (checked_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Таблица подписчиков на уведомления
    await connection.query(`
      CREATE TABLE IF NOT EXISTS notification_subscribers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        provider_id VARCHAR(255) NOT NULL,
        subscriber_id VARCHAR(255) NOT NULL,
        data TEXT DEFAULT '{}',
        subscribed_at BIGINT DEFAULT UNIX_TIMESTAMP(),
        is_active BOOLEAN DEFAULT true,
        UNIQUE KEY unique_provider_subscriber (provider_id, subscriber_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async syncServices(services: Service[]): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const service of services) {
        await connection.query(`
          INSERT INTO services (id, name, type, address, interval, timeout, service_group, warn_before, check_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            type = VALUES(type),
            address = VALUES(address),
            interval = VALUES(interval),
            timeout = VALUES(timeout),
            service_group = VALUES(service_group),
            warn_before = VALUES(warn_before),
            check_at = VALUES(check_at)
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

      await connection.commit();
      console.log(`MySQL: синхронизировано сервисов: ${services.length}`);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  async getAllServices(): Promise<any[]> {
    const connection = await this.pool.getConnection();
    try {
      const [rows] = await connection.query('SELECT *, service_group AS `group` FROM services ORDER BY service_group, name');
      return rows;
    } finally {
      connection.release();
    }
  }

  async getService(id: string): Promise<any> {
    const connection = await this.pool.getConnection();
    try {
      const [rows] = await connection.query('SELECT *, service_group AS `group` FROM services WHERE id = ?', [id]);
      return rows[0] || null;
    } finally {
      connection.release();
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
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      // Получаем текущий сервис
      const [serviceRows] = await connection.query(
        'SELECT failure_count FROM services WHERE id = ?',
        [serviceId]
      );

      if (serviceRows.length === 0) {
        await connection.rollback();
        connection.release();
        throw new Error(`Сервис ${serviceId} не найден`);
      }

      let failureCount = serviceRows[0].failure_count;
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
      await connection.query(`
        UPDATE services
        SET failure_count = ?, last_status = ?, last_check = UNIX_TIMESTAMP(),
            ssl_days_until_expiry = ?, ssl_expiry_date = ?
        WHERE id = ?
      `, [failureCount, lastStatus, sslDaysUntilExpiry, sslExpiryDate, serviceId]);

      // Записываем результат проверки
      await connection.query(`
        INSERT INTO checks (service_id, status, response_time, error_message)
        VALUES (?, ?, ?, ?)
      `, [
        serviceId,
        success ? 'success' : 'failure',
        responseTime,
        errorMessage
      ]);

      await connection.commit();
      return { failureCount, lastStatus: lastStatus as any };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  async getServiceChecks(serviceId: string, limit: number = 10): Promise<any[]> {
    const connection = await this.pool.getConnection();
    try {
      const [rows] = await connection.query(`
        SELECT * FROM checks
        WHERE service_id = ?
        ORDER BY checked_at DESC
        LIMIT ?
      `, [serviceId, limit]);
      return rows;
    } finally {
      connection.release();
    }
  }

  async getStats(periodHours: number = 24): Promise<any> {
    const connection = await this.pool.getConnection();
    try {
      const since = Math.floor(Date.now() / 1000) - (periodHours * 3600);
      const [rows] = await connection.query(`
        SELECT
          service_id,
          COUNT(*) as total_checks,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
          AVG(response_time) as avg_response_time
        FROM checks
        WHERE checked_at > ?
        GROUP BY service_id
      `, [since]);
      return rows;
    } finally {
      connection.release();
    }
  }

  async getServiceLastNotifiedStatus(serviceId: string): Promise<string> {
    const connection = await this.pool.getConnection();
    try {
      const [rows] = await connection.query('SELECT last_notified_status FROM services WHERE id = ?', [serviceId]);
      return rows[0]?.last_notified_status || 'unknown';
    } finally {
      connection.release();
    }
  }

  async updateServiceLastNotifiedStatus(serviceId: string, status: string): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.query('UPDATE services SET last_notified_status = ? WHERE id = ?', [status, serviceId]);
    } finally {
      connection.release();
    }
  }

  async addNotificationSubscriber(providerId: string, subscriberId: string, data?: any): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      const dataStr = data ? JSON.stringify(data) : '{}';
      await connection.query(`
        INSERT INTO notification_subscribers (provider_id, subscriber_id, data, is_active, subscribed_at)
        VALUES (?, ?, ?, true, UNIX_TIMESTAMP())
        ON DUPLICATE KEY UPDATE
          data = VALUES(data),
          is_active = true,
          subscribed_at = VALUES(subscribed_at)
      `, [providerId, subscriberId, dataStr]);
    } finally {
      connection.release();
    }
  }

  async removeNotificationSubscriber(providerId: string, subscriberId: string): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.query(`
        UPDATE notification_subscribers SET is_active = false WHERE provider_id = ? AND subscriber_id = ?
      `, [providerId, subscriberId]);
    } finally {
      connection.release();
    }
  }

  async getNotificationSubscribers(providerId: string): Promise<any[]> {
    const connection = await this.pool.getConnection();
    try {
      const [rows] = await connection.query(`
        SELECT subscriber_id, data, subscribed_at FROM notification_subscribers 
        WHERE provider_id = ? AND is_active = true
      `, [providerId]);
      return rows;
    } finally {
      connection.release();
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }
}