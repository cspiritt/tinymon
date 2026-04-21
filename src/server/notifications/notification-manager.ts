import { NotificationProviderConfig, ServiceStatus } from '../types';
import { NotificationProvider, NotificationMessage } from './notification-provider';
import { TelegramNotificationProvider } from './telegram-provider';
import config from '../utils/config';
import database from '../models/database';
import { notificationLogger } from '../utils/logger';

export class NotificationManager {
  private providers: Map<string, NotificationProvider> = new Map();
  private isInitialized: boolean = false;

  constructor() {}

  /**
   * Инициализация менеджера уведомлений
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const settings = config.getSettings();
    const providerConfigs = settings.notification_providers || [];

    notificationLogger.info(`Инициализация уведомлений: найдено ${providerConfigs.length} провайдеров`);

    for (const providerConfig of providerConfigs) {
      try {
        await this.addProvider(providerConfig);
      } catch (err) {
        notificationLogger.error(`Ошибка инициализации провайдера ${providerConfig.id}:`, err);
      }
    }

    this.isInitialized = true;
    notificationLogger.info('Менеджер уведомлений инициализирован');
  }

  /**
   * Добавление провайдера уведомлений
   */
  async addProvider(providerConfig: NotificationProviderConfig): Promise<void> {
    let provider: NotificationProvider;

    switch (providerConfig.type) {
      case 'telegram':
        provider = new TelegramNotificationProvider(providerConfig.id, providerConfig.parameters);
        break;
      default:
        throw new Error(`Неизвестный тип провайдера уведомлений: ${providerConfig.type}`);
    }

    await provider.initialize();
    this.providers.set(providerConfig.id, provider);
    notificationLogger.info(`Провайдер уведомлений ${providerConfig.id} (${providerConfig.type}) добавлен`);
  }

  /**
   * Отправка уведомления о изменении статуса сервиса всем провайдерам
   */
  async notifyServiceStatusChange(message: NotificationMessage): Promise<void> {
    if (this.providers.size === 0) {
      return;
    }

    notificationLogger.info(`Отправка уведомления о изменении статуса сервиса ${message.serviceName}`);

    const promises = Array.from(this.providers.values()).map(provider =>
      provider.sendNotification(message).catch(err => {
        notificationLogger.error(`Ошибка отправки уведомления через провайдер ${provider.constructor.name}:`, err);
      })
    );

    await Promise.all(promises);
  }

  /**
   * Получить провайдера по ID
   */
  getProvider(providerId: string): NotificationProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Получить список всех провайдеров
   */
  getAllProviders(): NotificationProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Проверить изменение статуса и отправить уведомление при необходимости
   */
  async checkAndNotifyStatusChange(
    serviceId: string,
    serviceName: string,
    currentStatus: ServiceStatus,
    errorMessage?: string,
    sslDaysUntilExpiry?: number
  ): Promise<void> {
    if (this.providers.size === 0) {
      return;
    }

    try {
      const previousNotifiedStatus = await database.getServiceLastNotifiedStatus(serviceId);
      
      // Если статус не изменился, не отправляем уведомление
      if (previousNotifiedStatus === currentStatus) {
        return;
      }

      // Обновляем последний отправленный статус
      await database.updateServiceLastNotifiedStatus(serviceId, currentStatus);

      const message: NotificationMessage = {
        serviceId,
        serviceName,
        previousStatus: previousNotifiedStatus as ServiceStatus,
        currentStatus,
        timestamp: Date.now(),
        errorMessage,
        sslDaysUntilExpiry
      };

      // Отправляем уведомление асинхронно (не ждем завершения)
      this.notifyServiceStatusChange(message).catch(err => {
        notificationLogger.error('Ошибка при отправке уведомления:', err);
      });

      notificationLogger.info(`Статус сервиса ${serviceName} изменился: ${previousNotifiedStatus} -> ${currentStatus}, отправлено уведомление`);
    } catch (err) {
      notificationLogger.error('Ошибка при проверке изменения статуса:', err);
    }
  }

  /**
   * Остановка всех провайдеров
   */
  async shutdown(): Promise<void> {
    notificationLogger.info('Остановка менеджера уведомлений...');
    
    for (const provider of this.providers.values()) {
      if ('shutdown' in provider && typeof (provider as any).shutdown === 'function') {
        try {
          await (provider as any).shutdown();
        } catch (err) {
          notificationLogger.error('Ошибка остановки провайдера:', err);
        }
      }
    }
    
    this.providers.clear();
    this.isInitialized = false;
    notificationLogger.info('Менеджер уведомлений остановлен');
  }
}

// Экспортируем синглтон
export default new NotificationManager();