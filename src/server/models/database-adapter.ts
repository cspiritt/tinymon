import { Service, CheckResult } from '../types';
import { DatabaseConfig } from '../types';

export interface UpdateServiceStatusResult {
  failureCount: number;
  lastStatus: 'OK' | 'WARNING' | 'ERROR' | 'unknown';
}

/**
 * Abstract database adapter class
 */
export abstract class DatabaseAdapter {
  protected config: DatabaseConfig;
  protected db: any;

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.db = null;
  }

  /**
   * Connect to database
   */
  abstract connect(): Promise<void>;

  /**
   * Create tables (if they don't exist)
   */
  abstract createTables(): Promise<void>;

  /**
   * Sync services from configuration
   * @param services - array of services
   */
  abstract syncServices(services: Service[]): Promise<void>;

  /**
   * Get all services with current state
   */
  abstract getAllServices(): Promise<any[]>;

  /**
   * Get service by ID
   * @param id - service identifier
   */
  abstract getService(id: string): Promise<any>;

  /**
   * Update service status after check
   * @param serviceId - service identifier
   * @param success - check success
   * @param responseTime - response time in ms
   * @param errorMessage - error message
   * @param options - additional options (for SSL)
   * @returns object with failureCount and lastStatus
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
   * Get check history for service
   * @param serviceId - service identifier
   * @param limit - number of records
   */
  abstract getServiceChecks(serviceId: string, limit?: number): Promise<any[]>;

  /**
   * Get statistics for period
   * @param periodHours - period in hours
   */
  abstract getStats(periodHours?: number): Promise<any>;

  /**
   * Close database connection
   */
  abstract close(): Promise<void>;

  // Methods for notifications
  abstract getServiceLastNotifiedStatus(serviceId: string): Promise<string>;
  abstract updateServiceLastNotifiedStatus(serviceId: string, status: string): Promise<void>;
  
  // Methods for notification subscribers
  abstract addNotificationSubscriber(providerId: string, subscriberId: string, data?: any): Promise<void>;
  abstract removeNotificationSubscriber(providerId: string, subscriberId: string): Promise<void>;
  abstract getNotificationSubscribers(providerId: string): Promise<any[]>;
}