import DatabaseFactory from './database-factory';
import config from '../utils/config';
import { Service } from '../types';
import { DatabaseAdapter, UpdateServiceStatusResult } from './database-adapter';
import { dbLogger } from '../utils/logger';

class DatabaseManager {
  private adapter: DatabaseAdapter | null = null;

  async connect(): Promise<void> {
    if (this.adapter) {
      return;
    }

    try {
      this.adapter = await DatabaseFactory.createAdapter();
      dbLogger.info(`Database connected (type: ${config.getSettings().database.type})`);
    } catch (err) {
      dbLogger.error('Database connection error:', (err as Error).message);
      throw err;
    }
  }

  async syncServices(services: Service[]): Promise<void> {
    if (!this.adapter) {
      await this.connect();
    }
    return this.adapter!.syncServices(services);
  }

  async getAllServices(): Promise<any[]> {
    if (!this.adapter) {
      await this.connect();
    }
    return this.adapter!.getAllServices();
  }

  async getService(id: string): Promise<any> {
    if (!this.adapter) {
      await this.connect();
    }
    return this.adapter!.getService(id);
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
    if (!this.adapter) {
      await this.connect();
    }
    return this.adapter!.updateServiceStatus(serviceId, success, responseTime, errorMessage, options);
  }

  async getServiceChecks(serviceId: string, limit: number = 10): Promise<any[]> {
    if (!this.adapter) {
      await this.connect();
    }
    return this.adapter!.getServiceChecks(serviceId, limit);
  }

  async getStats(periodHours: number = 24): Promise<any> {
    if (!this.adapter) {
      await this.connect();
    }
    return this.adapter!.getStats(periodHours);
  }

  async getServiceLastNotifiedStatus(serviceId: string): Promise<string> {
    if (!this.adapter) {
      await this.connect();
    }
    return this.adapter!.getServiceLastNotifiedStatus(serviceId);
  }

  async updateServiceLastNotifiedStatus(serviceId: string, status: string): Promise<void> {
    if (!this.adapter) {
      await this.connect();
    }
    return this.adapter!.updateServiceLastNotifiedStatus(serviceId, status);
  }

  async addNotificationSubscriber(providerId: string, subscriberId: string, data?: any): Promise<void> {
    if (!this.adapter) {
      await this.connect();
    }
    return this.adapter!.addNotificationSubscriber(providerId, subscriberId, data);
  }

  async removeNotificationSubscriber(providerId: string, subscriberId: string): Promise<void> {
    if (!this.adapter) {
      await this.connect();
    }
    return this.adapter!.removeNotificationSubscriber(providerId, subscriberId);
  }

  async getNotificationSubscribers(providerId: string): Promise<any[]> {
    if (!this.adapter) {
      await this.connect();
    }
    return this.adapter!.getNotificationSubscribers(providerId);
  }

  async close(): Promise<void> {
    if (this.adapter) {
      await this.adapter.close();
      this.adapter = null;
    }
  }
}

// Export singleton
export default new DatabaseManager();