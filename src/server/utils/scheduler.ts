import cron, { ScheduledTask } from 'node-cron';
import config from './config';
import checker from './checker';
import database from '../models/database';
import { Service } from '../types';

class Scheduler {
  private jobs: Map<string, ScheduledTask>;

  constructor() {
    this.jobs = new Map();
  }

  start(): void {
    console.log('Запуск планировщика проверок...');
    this.scheduleAllServices();

    // Также планируем перезагрузку конфигурации каждые 5 минут
    cron.schedule('*/5 * * * *', () => {
      this.reloadConfiguration();
    });
  }

  private scheduleAllServices(): void {
    // Останавливаем существующие задачи
    this.stopAll();

    const services = config.getServices();
    for (const service of services) {
      this.scheduleService(service);
    }
    console.log(`Запланировано проверок: ${services.length}`);
  }

  private scheduleService(service: Service): void {
    let cronExpression: string;
    
    if (service.type === 'ssl') {
      // Для SSL сервисов используем время check_at для ежедневной проверки
      cronExpression = this.generateCronExpressionForSSL(service);
      console.log(`SSL сервис ${service.name}: проверка по расписанию ${cronExpression} (${service.check_at})`);
    } else {
      // Конвертируем интервал в секундах в cron-выражение
      // Например, каждые 30 секунд: */30 * * * * *
      // Но node-cron поддерживает секунды (шесть полей)
      const interval = service.interval;
      if (interval < 10) {
        console.warn(`Слишком маленький интервал для сервиса ${service.name}: ${interval} секунд. Минимум 10 секунд.`);
        return;
      }

      // Создаем cron-выражение: каждые N секунд
      cronExpression = `*/${interval} * * * * *`;
    }

    const job = cron.schedule(cronExpression, async () => {
      await this.executeCheck(service);
    }, {
      timezone: 'UTC'
    });

    this.jobs.set(service.id, job);

    // Немедленно выполняем первую проверку
    setTimeout(() => {
      this.executeCheck(service);
    }, 1000);
  }
  
  private generateCronExpressionForSSL(service: Service): string {
    // Формат check_at: "HH:MM", по умолчанию "00:00"
    const checkAt = service.check_at || '00:00';
    const [hourStr, minuteStr] = checkAt.split(':');
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);
    
    // Проверяем валидность
    if (isNaN(hour) || hour < 0 || hour > 23 || isNaN(minute) || minute < 0 || minute > 59) {
      console.warn(`Некорректное время check_at для SSL сервиса ${service.name}: ${checkAt}, используем 00:00`);
      return '0 0 * * *';
    }
    
    // Cron-выражение: minute hour * * * (пять полей, без секунд)
    return `${minute} ${hour} * * *`;
  }

  private async executeCheck(service: Service): Promise<void> {
    console.log(`Проверка сервиса: ${service.name} (${service.address})`);
    try {
      const result = await checker.checkService(service);
      const statusEmoji = result.success ? '✅' : '❌';
      console.log(`${statusEmoji} ${service.name}: ${result.status} (ошибок: ${result.failureCount})`);
    } catch (err) {
      console.error(`Ошибка при проверке сервиса ${service.name}:`, (err as Error).message);
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
    console.log('Перезагрузка конфигурации...');
    await config.load();
    database.syncServices(config.getServices());
    this.scheduleAllServices();
  }
}

export default new Scheduler();