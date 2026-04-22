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
   * Notification manager initialization
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const settings = config.getSettings();
    const providerConfigs = settings.notification_providers || [];

    notificationLogger.info(`Notification initialization: found ${providerConfigs.length} providers`);

    for (const providerConfig of providerConfigs) {
      try {
        await this.addProvider(providerConfig);
      } catch (err) {
        notificationLogger.error(`Error initializing provider ${providerConfig.id}:`, err);
      }
    }

    this.isInitialized = true;
    notificationLogger.info('Notification manager initialized');
  }

  /**
   * Add notification provider
   */
  async addProvider(providerConfig: NotificationProviderConfig): Promise<void> {
    let provider: NotificationProvider;

    switch (providerConfig.type) {
      case 'telegram':
        provider = new TelegramNotificationProvider(providerConfig.id, providerConfig.parameters);
        break;
      default:
        throw new Error(`Unknown notification provider type: ${providerConfig.type}`);
    }

    await provider.initialize();
    this.providers.set(providerConfig.id, provider);
    notificationLogger.info(`Notification provider ${providerConfig.id} (${providerConfig.type}) added`);
  }

  /**
   * Send service status change notification to all providers
   */
  async notifyServiceStatusChange(message: NotificationMessage): Promise<void> {
    if (this.providers.size === 0) {
      return;
    }

    notificationLogger.info(`Sending service status change notification for ${message.serviceName}`);

    const promises = Array.from(this.providers.values()).map(provider =>
      provider.sendNotification(message).catch(err => {
        notificationLogger.error(`Error sending notification via provider ${provider.constructor.name}:`, err);
      })
    );

    await Promise.all(promises);
  }

  /**
   * Get provider by ID
   */
  getProvider(providerId: string): NotificationProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get all providers list
   */
  getAllProviders(): NotificationProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Check status change and send notification if needed
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
      
      // If status hasn't changed, don't send notification
      if (previousNotifiedStatus === currentStatus) {
        return;
      }

      // Update last notified status
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

      // Send notification asynchronously (don't wait for completion)
      this.notifyServiceStatusChange(message).catch(err => {
        notificationLogger.error('Error sending notification:', err);
      });

      notificationLogger.info(`Service status ${serviceName} changed: ${previousNotifiedStatus} -> ${currentStatus}, notification sent`);
    } catch (err) {
      notificationLogger.error('Error checking status change:', err);
    }
  }

  /**
   * Stop all providers
   */
  async shutdown(): Promise<void> {
    notificationLogger.info('Stopping notification manager...');
    
    for (const provider of this.providers.values()) {
      if ('shutdown' in provider && typeof (provider as any).shutdown === 'function') {
        try {
          await (provider as any).shutdown();
        } catch (err) {
          notificationLogger.error('Error stopping provider:', err);
        }
      }
    }
    
    this.providers.clear();
    this.isInitialized = false;
    notificationLogger.info('Notification manager stopped');
  }
}

// Export singleton
export default new NotificationManager();