import config from './config';
import database from '../models/database';
import { checkIpAddress } from './tcp-ping';
import { checkSSLCertificate } from './ssl-checker';
import notificationManager from '../notifications/notification-manager';
import { Service, CheckResult } from '../types';
import { checkerLogger } from './logger';

class ServiceChecker {
  private timeout: number;

  constructor() {
    this.timeout = config.getSettings().timeout;
  }

  async checkService(service: Service): Promise<CheckResult> {
    const startTime = Date.now();
    let success = false;
    let responseTime: number | null = null;
    let errorMessage: string | null = null;

    try {
      if (service.type === 'http') {
        await this.checkHttp(service);
        responseTime = Date.now() - startTime;
        success = true;
      } else if (service.type === 'ip') {
        await this.checkIp(service);
        responseTime = Date.now() - startTime;
        success = true;
      } else if (service.type === 'ssl') {
        // SSL check returns a ready CheckResult
        const sslResult = await checkSSLCertificate(service);
        responseTime = sslResult.responseTime;
        success = sslResult.success;
        errorMessage = sslResult.errorMessage;

        // Update status in database with SSL fields
        const result = await database.updateServiceStatus(
          service.id,
          success,
          responseTime,
          errorMessage,
          {
            ssl_days_until_expiry: sslResult.ssl_days_until_expiry,
            ssl_expiry_date: sslResult.ssl_expiry_date
          }
        );

        const failureCount = result ? result.failureCount : 0;
        const status = sslResult.status;

        // Send notification on status change
        notificationManager.checkAndNotifyStatusChange(
          service.id,
          service.name,
          status,
          errorMessage || undefined,
          sslResult.ssl_days_until_expiry
        ).catch(err => checkerLogger.error('Error sending notification:', err));

        return {
          ...sslResult,
          failureCount,
          status
        };
      } else {
        throw new Error(`Unknown service type: ${service.type}`);
      }
    } catch (err) {
      errorMessage = (err as Error).message;
      success = false;
    }

    // Update status in database
    const result = await database.updateServiceStatus(
      service.id,
      success,
      responseTime,
      errorMessage
    );

    const failureCount = result ? result.failureCount : 0;
    const status = this.getStatus(failureCount);

    // Send notification on status change
    notificationManager.checkAndNotifyStatusChange(
      service.id,
      service.name,
      status,
      errorMessage || undefined
    ).catch(err => checkerLogger.error('Error sending notification:', err));

    return {
      serviceId: service.id,
      serviceName: service.name,
      success,
      responseTime,
      errorMessage,
      failureCount,
      status
    };
  }

  private async checkHttp(service: Service): Promise<void> {
    const timeout = service.timeout || this.timeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(service.address, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'TinyMon/1.0'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      // Check that response is not too large (headers only)
      // Additional checks can be added here
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Timeout ${timeout}ms`);
      }
      throw err;
    }
  }

  private async checkIp(service: Service): Promise<void> {
    const timeout = service.timeout || this.timeout;
    const isAlive = await checkIpAddress(service.address, timeout);

    if (!isAlive) {
      throw new Error('TCP ping failed');
    }
  }

  private getStatus(failureCount: number): 'OK' | 'WARNING' | 'ERROR' | 'unknown' {
    if (failureCount === 0) {
      return 'OK';
    } else if (failureCount < 3) {
      return 'WARNING';
    } else {
      return 'ERROR';
    }
  }
}

export default new ServiceChecker();