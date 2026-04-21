import { Service, CheckResult } from '../types';
import { DatabaseConfig } from '../types';

export interface UpdateServiceStatusResult {
  failureCount: number;
  lastStatus: 'OK' | 'WARNING' | 'ERROR' | 'unknown';
}

/**
 * Абстрактный класс адаптера базы данных
 */
export abstract class DatabaseAdapter {
  protected config: DatabaseConfig;
  protected db: any;

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.db = null;
  }

  /**
   * Подключение к базе данных
   */
  abstract connect(): Promise<void>;

  /**
   * Создание таблиц (если не существуют)
   */
  abstract createTables(): Promise<void>;

  /**
   * Синхронизация сервисов из конфигурации
   * @param services - массив сервисов
   */
  abstract syncServices(services: Service[]): Promise<void>;

  /**
   * Получить все сервисы с текущим состоянием
   */
  abstract getAllServices(): Promise<any[]>;

  /**
   * Получить сервис по ID
   * @param id - идентификатор сервиса
   */
  abstract getService(id: string): Promise<any>;

  /**
   * Обновить статус сервиса после проверки
   * @param serviceId - идентификатор сервиса
   * @param success - успешность проверки
   * @param responseTime - время ответа в мс
   * @param errorMessage - сообщение об ошибке
   * @param options - дополнительные опции (для SSL)
   * @returns объект с failureCount и lastStatus
   */
  abstract updateServiceStatus(
    serviceId: string,
    success: boolean,
    responseTime: number | null,
    errorMessage: string | null,
    options?: {
      ssl_days_until_expiry?: number;
      ssl_expiry_date?: Date;
    }
  ): Promise<UpdateServiceStatusResult>;

  /**
   * Получить историю проверок для сервиса
   * @param serviceId - идентификатор сервиса
   * @param limit - количество записей
   */
  abstract getServiceChecks(serviceId: string, limit?: number): Promise<any[]>;

  /**
   * Получить статистику за период
   * @param periodHours - период в часах
   */
  abstract getStats(periodHours?: number): Promise<any>;

  /**
   * Закрыть соединение с БД
   */
  abstract close(): Promise<void>;

  // Методы для уведомлений
  abstract getServiceLastNotifiedStatus(serviceId: string): Promise<string>;
  abstract updateServiceLastNotifiedStatus(serviceId: string, status: string): Promise<void>;
  
  // Методы для подписчиков на уведомления
  abstract addNotificationSubscriber(providerId: string, subscriberId: string, data?: any): Promise<void>;
  abstract removeNotificationSubscriber(providerId: string, subscriberId: string): Promise<void>;
  abstract getNotificationSubscribers(providerId: string): Promise<any[]>;
}