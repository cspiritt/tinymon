import { NotificationProvider, NotificationMessage } from './notification-provider';
import database from '../models/database';
import { notificationLogger } from '../utils/logger';

// Dynamic import to avoid inclusion in bundle
let TelegramBot: any;

try {
  TelegramBot = require('node-telegram-bot-api');
} catch (err) {
  notificationLogger.warn('Library node-telegram-bot-api is not installed. Telegram notifications will not work.');
}

export class TelegramNotificationProvider extends NotificationProvider {
  private bot: any;
  private isInitialized: boolean = false;

  constructor(providerId: string, parameters: Record<string, any>) {
    super(providerId, parameters);
    
    // Required parameters check
    if (!parameters.token) {
      throw new Error('Token for Telegram bot is not specified');
    }
  }

  async initialize(): Promise<void> {
    if (!TelegramBot) {
      throw new Error('Library node-telegram-bot-api is not installed. Install it via npm install node-telegram-bot-api');
    }

    try {
      const options: any = {
        polling: true
      };

      // If webhook specified, use it
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

      // Command setup
      this.bot.setMyCommands([
        { command: 'start', description: 'Subscribe to notifications' },
        { command: 'stop', description: 'Unsubscribe from notifications' },
        { command: 'status', description: 'Show subscription status' }
      ]);

      // Log all messages
      this.bot.on('message', (msg: any) => {
        const chatId = msg.chat.id;
        const username = msg.chat.username || 'no username';
        const firstName = msg.chat.first_name || '';
        const lastName = msg.chat.last_name || '';
        const text = msg.text || '';
        
        notificationLogger.info(`[Telegram Bot] Message from ${chatId} (@${username}, ${firstName} ${lastName}): ${text}`);
      });

      // Command handling
      this.bot.onText(/\/start/, async (msg: any) => {
        const chatId = msg.chat.id;
        try {
          notificationLogger.info(`[Telegram Bot] Processing command /start from ${chatId}`);
          const response = await this.handleCommand('start', chatId.toString());
          this.bot.sendMessage(chatId, response);
        } catch (err) {
          notificationLogger.error('Error processing command /start:', err);
          this.bot.sendMessage(chatId, 'An error occurred during subscription');
        }
      });

      this.bot.onText(/\/stop/, async (msg: any) => {
        const chatId = msg.chat.id;
        try {
          notificationLogger.info(`[Telegram Bot] Processing command /stop from ${chatId}`);
          const response = await this.handleCommand('stop', chatId.toString());
          this.bot.sendMessage(chatId, response);
        } catch (err) {
          notificationLogger.error('Error processing command /stop:', err);
          this.bot.sendMessage(chatId, 'An error occurred during unsubscription');
        }
      });

      this.bot.onText(/\/status/, async (msg: any) => {
        const chatId = msg.chat.id;
        try {
          const subscribers = await this.getSubscribers();
          const isSubscribed = subscribers.some((sub: any) => sub.subscriber_id === chatId.toString());
          if (isSubscribed) {
            this.bot.sendMessage(chatId, '✅ You are subscribed to notifications. Use /stop to unsubscribe');
          } else {
            this.bot.sendMessage(chatId, '❌ You are not subscribed to notifications. Use /start to subscribe');
          }
        } catch (err) {
          notificationLogger.error('Error processing command /status:', err);
          this.bot.sendMessage(chatId, 'An error occurred while checking status');
        }
      });

      // Error handling
      this.bot.on('polling_error', (error: Error) => {
        notificationLogger.error('Telegram bot polling error:', error);
      });

      notificationLogger.info(`Telegram bot ${this.providerId} initialized`);
      notificationLogger.info(`Bot parameters:`, {
        token: this.parameters.token ? '***' + this.parameters.token.slice(-4) : 'not specified',
        allowed_subscribers: this.parameters.allowed_subscribers,
        webhook: this.parameters.webhook ? 'configured' : 'not configured'
      });
    } catch (err) {
      notificationLogger.error('Telegram bot initialization error:', err);
      throw err;
    }
  }

  async sendNotification(message: NotificationMessage): Promise<void> {
    if (!this.isInitialized || !this.bot) {
      notificationLogger.warn('Telegram bot not initialized, skipping notification');
      return;
    }

    try {
      const subscribers = await this.getSubscribers();
      if (subscribers.length === 0) {
        notificationLogger.info('No subscribers to send notification');
        return;
      }

      const text = this.formatMessage(message);
      
      // Send to each subscriber
      for (const subscriber of subscribers) {
        try {
          await this.bot.sendMessage(subscriber.subscriber_id, text, {
            parse_mode: 'Markdown'
          });
        } catch (err: any) {
          notificationLogger.error(`Error sending notification to subscriber ${subscriber.subscriber_id}:`, err.message);
          // If user blocked the bot, unsubscribe them
          if (err.response?.body?.error_code === 403) {
            notificationLogger.info(`User ${subscriber.subscriber_id} blocked the bot, unsubscribing`);
            await database.removeNotificationSubscriber(this.providerId, subscriber.subscriber_id);
          }
        }
      }

      notificationLogger.info(`Notification sent for service ${message.serviceName} to subscribers: ${subscribers.length}`);
    } catch (err) {
      notificationLogger.error('Error sending notification:', err);
    }
  }

  /**
   * Format message for Telegram (override for Markdown)
   */
  protected formatMessage(message: NotificationMessage): string {
    const time = new Date(message.timestamp).toLocaleString('ru-RU');
    let statusText = '';
    
    switch (message.currentStatus) {
      case 'OK':
        statusText = '✅ *Restored*';
        break;
      case 'WARNING':
        statusText = '⚠️ *Warning*';
        break;
      case 'ERROR':
        statusText = '❌ *Error*';
        break;
      default:
        statusText = `*Status: ${message.currentStatus}*`;
    }

    let details = '';
    if (message.errorMessage) {
      details += `\n*Error:* ${message.errorMessage}`;
    }
    if (message.sslDaysUntilExpiry !== undefined) {
      if (message.sslDaysUntilExpiry > 0) {
        details += `\n*SSL certificate expires in* ${message.sslDaysUntilExpiry} days`;
      } else if (message.sslDaysUntilExpiry === 0) {
        details += `\n*SSL certificate expires today!*`;
      } else {
        details += `\n*SSL certificate expired* ${-message.sslDaysUntilExpiry} days ago`;
      }
    }

    return `📡 *${message.serviceName}*\n` +
           `${statusText}\n` +
           `*Previous status:* ${message.previousStatus}\n` +
           `*Time:* ${time}` +
           details;
  }

  /**
   * Handle commands from users with permission checking
   */
  async handleCommand(command: string, subscriberId: string, args?: string[]): Promise<string> {
    notificationLogger.info(`[Telegram Bot] Command: ${command} from user ${subscriberId}`);

    switch (command) {
      case 'start':
        // Check if user is allowed
        if (this.parameters.allowed_subscribers &&
            Array.isArray(this.parameters.allowed_subscribers)) {

          notificationLogger.info(`[Telegram Bot] Checking permissions: allowed_subscribers =`, this.parameters.allowed_subscribers);
          const allowedIds = this.parameters.allowed_subscribers.map(id => id.toString());
          const subscriberIdStr = subscriberId.toString();
          notificationLogger.info(`[Telegram Bot] Comparing: ${subscriberIdStr} with allowed:`, allowedIds);

          if (!allowedIds.includes(subscriberIdStr)) {
            notificationLogger.info(`[Telegram Bot] Access denied for user ${subscriberIdStr}`);
            return '⛔ Access denied. You are not in the allowed users list.';
          }
          notificationLogger.info(`[Telegram Bot] User ${subscriberIdStr} allowed`);
        } else {
          notificationLogger.info(`[Telegram Bot] allowed_subscribers not specified or not an array, access open to all`);
        }

        await database.addNotificationSubscriber(this.providerId, subscriberId);
        notificationLogger.info(`[Telegram Bot] User ${subscriberId} subscribed to notifications`);
        return '✅ You have subscribed to service status change notifications. Use /stop to unsubscribe';

      case 'stop':
        await database.removeNotificationSubscriber(this.providerId, subscriberId);
        notificationLogger.info(`[Telegram Bot] User ${subscriberId} unsubscribed from notifications`);
        return '✅ You have unsubscribed from notifications. Use /start to subscribe';

      default:
        // Try base implementation for other commands
        notificationLogger.info(`[Telegram Bot] Unknown command ${command}, passing to base class`);
        return super.handleCommand(command, subscriberId, args);
    }
  }

  /**
   * Stop the bot
   */
  async shutdown(): Promise<void> {
    if (this.bot) {
      this.bot.stopPolling();
      notificationLogger.info(`Telegram bot ${this.providerId} stopped`);
    }
  }
}