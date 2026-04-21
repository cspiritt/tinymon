import { ServiceState, ServiceStatus } from '../types';
import database from '../models/database';

export interface NotificationMessage {
  serviceId: string;
  serviceName: string;
  previousStatus: ServiceStatus;
  currentStatus: ServiceStatus;
  timestamp: number;
  errorMessage?: string;
  sslDaysUntilExpiry?: number;
}

export abstract class NotificationProvider {
  protected providerId: string;
  protected parameters: Record<string, any>;

  constructor(providerId: string, parameters: Record<string, any>) {
    this.providerId = providerId;
    this.parameters = parameters;
  }

  /**
   * Инициализация провайдера (подключение к API, запуск бота и т.д.)
   */
  abstract initialize(): Promise<void>;

  /**
   * Отправка уведомления о изменении статуса сервиса
   */
  abstract sendNotification(message: NotificationMessage): Promise<void>;

  /**
   * Обработка команд от пользователей (для ботов)
   * @param command - команда
   * @param subscriberId - идентификатор подписчика
   * @param args - аргументы команды
   */
  async handleCommand(command: string, subscriberId: string, args?: string[]): Promise<string> {
    // Базовая реализация для команд /start и /stop
    switch (command) {
      case 'start':
        await database.addNotificationSubscriber(this.providerId, subscriberId);
        return 'Вы подписались на уведомления о изменении статуса сервисов. Для отписки используйте /stop';
      
      case 'stop':
        await database.removeNotificationSubscriber(this.providerId, subscriberId);
        return 'Вы отписались от уведомлений. Для подписки используйте /start';
      
      default:
        return `Неизвестная команда: ${command}. Доступные команды: /start, /stop`;
    }
  }

  /**
   * Получить список активных подписчиков
   */
  async getSubscribers(): Promise<any[]> {
    return database.getNotificationSubscribers(this.providerId);
  }

  /**
   * Форматирование сообщения для уведомления
   */
  protected formatMessage(message: NotificationMessage): string {
    const time = new Date(message.timestamp).toLocaleString('ru-RU');
    let statusText = '';
    
    switch (message.currentStatus) {
      case 'OK':
        statusText = '✅ Восстановлен';
        break;
      case 'WARNING':
        statusText = '⚠️ Предупреждение';
        break;
      case 'ERROR':
        statusText = '❌ Ошибка';
        break;
      default:
        statusText = `Статус: ${message.currentStatus}`;
    }

    let details = '';
    if (message.errorMessage) {
      details += `\nОшибка: ${message.errorMessage}`;
    }
    if (message.sslDaysUntilExpiry !== undefined) {
      if (message.sslDaysUntilExpiry > 0) {
        details += `\nSSL сертификат истекает через ${message.sslDaysUntilExpiry} дней`;
      } else if (message.sslDaysUntilExpiry === 0) {
        details += `\nSSL сертификат истекает сегодня!`;
      } else {
        details += `\nSSL сертификат истек ${-message.sslDaysUntilExpiry} дней назад`;
      }
    }

    return `📡 **${message.serviceName}**\n` +
           `${statusText}\n` +
           `Предыдущий статус: ${message.previousStatus}\n` +
           `Время: ${time}` +
           details;
  }
}