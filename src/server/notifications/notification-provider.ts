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
   * Provider initialization (connecting to API, starting bot, etc.)
   */
  abstract initialize(): Promise<void>;

  /**
   * Sending notification about service status change
   */
  abstract sendNotification(message: NotificationMessage): Promise<void>;

  /**
   * Processing commands from users (for bots)
   * @param command - command
   * @param subscriberId - subscriber identifier
   * @param args - command arguments
   */
  async handleCommand(command: string, subscriberId: string, args?: string[]): Promise<string> {
    // Base implementation for /start and /stop commands
    switch (command) {
      case 'start':
        await database.addNotificationSubscriber(this.providerId, subscriberId);
        return 'You have subscribed to service status change notifications. Use /stop to unsubscribe.';
      
      case 'stop':
        await database.removeNotificationSubscriber(this.providerId, subscriberId);
        return 'You have unsubscribed from notifications. Use /start to subscribe.';
      
      default:
        return `Unknown command: ${command}. Available commands: /start, /stop`;
    }
  }

  /**
   * Get list of active subscribers
   */
  async getSubscribers(): Promise<any[]> {
    return database.getNotificationSubscribers(this.providerId);
  }

  /**
   * Formatting notification message
   */
  protected formatMessage(message: NotificationMessage): string {
    const time = new Date(message.timestamp).toLocaleString('en-US');
    let statusText = '';
    
    switch (message.currentStatus) {
      case 'OK':
        statusText = '✅ Restored';
        break;
      case 'WARNING':
        statusText = '⚠️ Warning';
        break;
      case 'ERROR':
        statusText = '❌ Error';
        break;
      default:
        statusText = `Status: ${message.currentStatus}`;
    }

    let details = '';
    if (message.errorMessage) {
      details += `\nError: ${message.errorMessage}`;
    }
    if (message.sslDaysUntilExpiry !== undefined) {
      if (message.sslDaysUntilExpiry > 0) {
        details += `\nSSL certificate expires in ${message.sslDaysUntilExpiry} days`;
      } else if (message.sslDaysUntilExpiry === 0) {
        details += `\nSSL certificate expires today!`;
      } else {
        details += `\nSSL certificate expired ${-message.sslDaysUntilExpiry} days ago`;
      }
    }

    return `📡 **${message.serviceName}**\n` +
           `${statusText}\n` +
           `Previous status: ${message.previousStatus}\n` +
           `Time: ${time}` +
           details;
  }
}