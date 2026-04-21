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
   * @returns объект с failureCount и lastStatus
   */
  abstract updateServiceStatus(
    serviceId: string,
    success: boolean,
    responseTime: number | null,
    errorMessage: string | null
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
}