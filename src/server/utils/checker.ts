import config from './config';
import database from '../models/database';
import { checkIpAddress } from './tcp-ping';
import { Service, CheckResult } from '../types';

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
      } else if (service.type === 'ip') {
        await this.checkIp(service);
      } else {
        throw new Error(`Неизвестный тип сервиса: ${service.type}`);
      }
      responseTime = Date.now() - startTime;
      success = true;
    } catch (err) {
      errorMessage = (err as Error).message;
      success = false;
    }

    // Обновляем статус в базе данных
    const result = await database.updateServiceStatus(
      service.id,
      success,
      responseTime,
      errorMessage
    );

    return {
      serviceId: service.id,
      serviceName: service.name,
      success,
      responseTime,
      errorMessage,
      failureCount: result ? result.failureCount : 0,
      status: this.getStatus(result ? result.failureCount : 0)
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

      // Проверяем, что ответ не слишком большой (только заголовки)
      // Дополнительные проверки можно добавить здесь
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Таймаут ${timeout}мс`);
      }
      throw err;
    }
  }

  private async checkIp(service: Service): Promise<void> {
    const timeout = service.timeout || this.timeout;
    const isAlive = await checkIpAddress(service.address, timeout);

    if (!isAlive) {
      throw new Error('TCP ping неудачен');
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