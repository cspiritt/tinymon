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

      // Логирование всех сообщений
      this.bot.on('message', (msg: any) => {
        const chatId = msg.chat.id;
        const username = msg.chat.username || 'без username';
        const firstName = msg.chat.first_name || '';
        const lastName = msg.chat.last_name || '';
        const text = msg.text || '';
        
        console.log(`[Telegram Bot] Сообщение от ${chatId} (@${username}, ${firstName} ${lastName}): ${text}`);
      });

      // Обработка команд
      this.bot.onText(/\/start/, async (msg: any) => {
        const chatId = msg.chat.id;
        try {
          console.log(`[Telegram Bot] Обработка команды /start от ${chatId}`);
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
          console.log(`[Telegram Bot] Обработка команды /stop от ${chatId}`);
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
      console.log(`Параметры бота:`, {
        token: this.parameters.token ? '***' + this.parameters.token.slice(-4) : 'не указан',
        allowed_subscribers: this.parameters.allowed_subscribers,
        webhook: this.parameters.webhook ? 'настроен' : 'не настроен'
      });
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
   * Обработка команд от пользователей с проверкой разрешений
   */
  async handleCommand(command: string, subscriberId: string, args?: string[]): Promise<string> {
    console.log(`[Telegram Bot] Команда: ${command} от пользователя ${subscriberId}`);
    
    switch (command) {
      case 'start':
        // Проверяем, разрешен ли пользователь
        if (this.parameters.allowed_subscribers &&
            Array.isArray(this.parameters.allowed_subscribers)) {
          
          console.log(`[Telegram Bot] Проверка разрешений: allowed_subscribers =`, this.parameters.allowed_subscribers);
          const allowedIds = this.parameters.allowed_subscribers.map(id => id.toString());
          const subscriberIdStr = subscriberId.toString();
          console.log(`[Telegram Bot] Сравниваем: ${subscriberIdStr} с разрешенными:`, allowedIds);

          if (!allowedIds.includes(subscriberIdStr)) {
            console.log(`[Telegram Bot] Доступ запрещен для пользователя ${subscriberIdStr}`);
            return '⛔ Доступ запрещен. Вы не в списке разрешенных пользователей.';
          }
          console.log(`[Telegram Bot] Пользователь ${subscriberIdStr} разрешен`);
        } else {
          console.log(`[Telegram Bot] allowed_subscribers не указан или не массив, доступ открыт для всех`);
        }

        await database.addNotificationSubscriber(this.providerId, subscriberId);
        console.log(`[Telegram Bot] Пользователь ${subscriberId} подписан на уведомления`);
        return '✅ Вы подписались на уведомления о изменении статуса сервисов. Для отписки используйте /stop';

      case 'stop':
        await database.removeNotificationSubscriber(this.providerId, subscriberId);
        console.log(`[Telegram Bot] Пользователь ${subscriberId} отписан от уведомлений`);
        return '✅ Вы отписались от уведомлений. Для подписки используйте /start';

      default:
        // Пробуем базовую реализацию для других команд
        console.log(`[Telegram Bot] Неизвестная команда ${command}, передаем в базовый класс`);
        return super.handleCommand(command, subscriberId, args);
    }
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