import { NotificationProvider, NotificationMessage } from './notification-provider';
import database from '../models/database';

// Динамический импорт для избежания включения в бандл
let TelegramBot: any;

try {
  TelegramBot = require('node-telegram-bot-api');
} catch (err) {
  console.warn('Библиотека node-telegram-bot-api не установлена. Telegram уведомления не будут работать.');
}

export class TelegramNotificationProvider extends NotificationProvider {
  private bot: any;
  private isInitialized: boolean = false;

  constructor(providerId: string, parameters: Record<string, any>) {
    super(providerId, parameters);
    
    // Проверка обязательных параметров
    if (!parameters.token) {
      throw new Error('Не указан token для Telegram бота');
    }
  }

  async initialize(): Promise<void> {
    if (!TelegramBot) {
      throw new Error('Библиотека node-telegram-bot-api не установлена. Установите ее через npm install node-telegram-bot-api');
    }

    try {
      const options: any = {
        polling: true
      };

      // Если указан webhook, используем его
      if (this.parameters.webhook) {
        options.webHook = {
          host: this.parameters.webhook.host || '0.0.0.0',
          port: this.parameters.webhook.port || 8443,
          key: this.parameters.webhook.key,
          cert: this.parameters.webhook.cert
        };
      }

      this.bot = new TelegramBot(this.parameters.token, options);
      this.isInitialized = true;

      // Настройка команд
      this.bot.setMyCommands([
        { command: 'start', description: 'Подписаться на уведомления' },
        { command: 'stop', description: 'Отписаться от уведомлений' },
        { command: 'status', description: 'Показать статус подписки' }
      ]);

      // Обработка команд
      this.bot.onText(/\/start/, async (msg: any) => {
        const chatId = msg.chat.id;
        try {
          const response = await this.handleCommand('start', chatId.toString());
          this.bot.sendMessage(chatId, response);
        } catch (err) {
          console.error('Ошибка обработки команды /start:', err);
          this.bot.sendMessage(chatId, 'Произошла ошибка при подписке');
        }
      });

      this.bot.onText(/\/stop/, async (msg: any) => {
        const chatId = msg.chat.id;
        try {
          const response = await this.handleCommand('stop', chatId.toString());
          this.bot.sendMessage(chatId, response);
        } catch (err) {
          console.error('Ошибка обработки команды /stop:', err);
          this.bot.sendMessage(chatId, 'Произошла ошибка при отписке');
        }
      });

      this.bot.onText(/\/status/, async (msg: any) => {
        const chatId = msg.chat.id;
        try {
          const subscribers = await this.getSubscribers();
          const isSubscribed = subscribers.some((sub: any) => sub.subscriber_id === chatId.toString());
          if (isSubscribed) {
            this.bot.sendMessage(chatId, '✅ Вы подписаны на уведомления. Для отписки используйте /stop');
          } else {
            this.bot.sendMessage(chatId, '❌ Вы не подписаны на уведомления. Для подписки используйте /start');
          }
        } catch (err) {
          console.error('Ошибка обработки команды /status:', err);
          this.bot.sendMessage(chatId, 'Произошла ошибка при проверке статуса');
        }
      });

      // Обработка ошибок
      this.bot.on('polling_error', (error: Error) => {
        console.error('Ошибка polling Telegram бота:', error);
      });

      console.log(`Telegram бот ${this.providerId} инициализирован`);
    } catch (err) {
      console.error('Ошибка инициализации Telegram бота:', err);
      throw err;
    }
  }

  async sendNotification(message: NotificationMessage): Promise<void> {
    if (!this.isInitialized || !this.bot) {
      console.warn('Telegram бот не инициализирован, пропускаем уведомление');
      return;
    }

    try {
      const subscribers = await this.getSubscribers();
      if (subscribers.length === 0) {
        console.log('Нет подписчиков для отправки уведомления');
        return;
      }

      const text = this.formatMessage(message);
      
      // Отправка каждому подписчику
      for (const subscriber of subscribers) {
        try {
          await this.bot.sendMessage(subscriber.subscriber_id, text, {
            parse_mode: 'Markdown'
          });
        } catch (err: any) {
          console.error(`Ошибка отправки уведомления подписчику ${subscriber.subscriber_id}:`, err.message);
          // Если пользователь заблокировал бота, отписываем его
          if (err.response?.body?.error_code === 403) {
            console.log(`Пользователь ${subscriber.subscriber_id} заблокировал бота, отписываем`);
            await database.removeNotificationSubscriber(this.providerId, subscriber.subscriber_id);
          }
        }
      }

      console.log(`Отправлено уведомление для сервиса ${message.serviceName} подписчикам: ${subscribers.length}`);
    } catch (err) {
      console.error('Ошибка отправки уведомления:', err);
    }
  }

  /**
   * Форматирование сообщения для Telegram (переопределяем для Markdown)
   */
  protected formatMessage(message: NotificationMessage): string {
    const time = new Date(message.timestamp).toLocaleString('ru-RU');
    let statusText = '';
    
    switch (message.currentStatus) {
      case 'OK':
        statusText = '✅ *Восстановлен*';
        break;
      case 'WARNING':
        statusText = '⚠️ *Предупреждение*';
        break;
      case 'ERROR':
        statusText = '❌ *Ошибка*';
        break;
      default:
        statusText = `*Статус: ${message.currentStatus}*`;
    }

    let details = '';
    if (message.errorMessage) {
      details += `\n*Ошибка:* ${message.errorMessage}`;
    }
    if (message.sslDaysUntilExpiry !== undefined) {
      if (message.sslDaysUntilExpiry > 0) {
        details += `\n*SSL сертификат истекает через* ${message.sslDaysUntilExpiry} дней`;
      } else if (message.sslDaysUntilExpiry === 0) {
        details += `\n*SSL сертификат истекает сегодня!*`;
      } else {
        details += `\n*SSL сертификат истек* ${-message.sslDaysUntilExpiry} дней назад`;
      }
    }

    return `📡 *${message.serviceName}*\n` +
           `${statusText}\n` +
           `*Предыдущий статус:* ${message.previousStatus}\n` +
           `*Время:* ${time}` +
           details;
  }

  /**
   * Остановка бота
   */
  async shutdown(): Promise<void> {
    if (this.bot) {
      this.bot.stopPolling();
      console.log(`Telegram бот ${this.providerId} остановлен`);
    }
  }
}