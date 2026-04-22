import cron, { ScheduledTask } from 'node-cron';
import config from './config';
import checker from './checker';
import database from '../models/database';
import { Service } from '../types';
import { schedulerLogger } from './logger';

class Scheduler {
  private jobs: Map<string, ScheduledTask>;

  constructor() {
    this.jobs = new Map();
  }

  start(): void {
    schedulerLogger.debug('Starting check scheduler...');
    this.scheduleAllServices();

    // Also schedule configuration reload every 5 minutes
    cron.schedule('*/5 * * * *', () => {
      this.reloadConfiguration();
    });
  }

  private scheduleAllServices(): void {
    // Stop existing tasks
    this.stopAll();

    const services = config.getServices();
    for (const service of services) {
      this.scheduleService(service);
    }
    schedulerLogger.debug(`Scheduled checks: ${services.length}`);
  }

  private scheduleService(service: Service): void {
    let cronExpression: string;
    
    if (service.type === 'ssl') {
      // For SSL services use check_at time for daily check
      cronExpression = this.generateCronExpressionForSSL(service);
      schedulerLogger.debug(`SSL service ${service.name}: scheduled check ${cronExpression} (${service.check_at})`);
    } else {
      // Convert interval in seconds to cron expression
      // For example, every 30 seconds: */30 * * * * *
      // But node-cron supports seconds (six fields)
      const interval = service.interval;
      if (interval < 10) {
        schedulerLogger.warn(`Interval too small for service ${service.name}: ${interval} seconds. Minimum 10 seconds.`);
        return;
      }

      // Create cron expression: every N seconds
      cronExpression = `*/${interval} * * * * *`;
    }

    const job = cron.schedule(cronExpression, async () => {
      await this.executeCheck(service);
    }, {
      timezone: 'UTC'
    });

    this.jobs.set(service.id, job);

    // Immediately perform first check
    setTimeout(() => {
      this.executeCheck(service);
    }, 1000);
  }
  
  private generateCronExpressionForSSL(service: Service): string {
    // Format check_at: "HH:MM", default "00:00"
    const checkAt = service.check_at || '00:00';
    const [hourStr, minuteStr] = checkAt.split(':');
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);
    
    // Validate
    if (isNaN(hour) || hour < 0 || hour > 23 || isNaN(minute) || minute < 0 || minute > 59) {
      schedulerLogger.warn(`Invalid check_at time for SSL service ${service.name}: ${checkAt}, using 00:00`);
      return '0 0 * * *';
    }
    
    // Cron expression: minute hour * * * (five fields, no seconds)
    return `${minute} ${hour} * * *`;
  }

  private async executeCheck(service: Service): Promise<void> {
    schedulerLogger.debug(`Checking service: ${service.name} (${service.address})`);
    try {
      const result = await checker.checkService(service);
      const statusEmoji = result.success ? '✅' : '❌';
      schedulerLogger.debug(`${statusEmoji} ${service.name}: ${result.status} (failures: ${result.failureCount})`);
    } catch (err) {
      schedulerLogger.error(`Error checking service ${service.name}:`, (err as Error).message);
    }
  }

  stopService(serviceId: string): void {
    const job = this.jobs.get(serviceId);
    if (job) {
      job.stop();
      this.jobs.delete(serviceId);
    }
  }

  stopAll(): void {
    for (const [id, job] of this.jobs) {
      job.stop();
    }
    this.jobs.clear();
  }

  private async reloadConfiguration(): Promise<void> {
    schedulerLogger.debug('Reloading configuration...');
    await config.load();
    database.syncServices(config.getServices());
    this.scheduleAllServices();
  }
}

export default new Scheduler();