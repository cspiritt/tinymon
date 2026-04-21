import { promises as fs } from 'fs';
import path from 'path';
import { Settings, Service } from '../types';
import Logger, { configLogger } from './logger';

class ConfigLoader {
  private settings: Settings;
  private services: Service[];

  constructor() {
    this.settings = {} as Settings;
    this.services = [];
  }

  async load(): Promise<void> {
    await this.loadSettings();
    await this.loadServices();
  }

  private async loadSettings(): Promise<void> {
    const settingsPath = path.join(process.cwd(), 'settings.json');
    try {
      const data = await fs.readFile(settingsPath, 'utf8');
      this.settings = JSON.parse(data);

      // Обратная совместимость: если database - строка, преобразуем в новую структуру
      if (typeof this.settings.database === 'string') {
        configLogger.info('Обновление структуры database для обратной совместимости');
        this.settings.database = {
          type: 'sqlite',
          sqlite: {
            path: this.settings.database
          },
          postgres: {
            host: 'localhost',
            port: 5432,
            database: 'tinymon',
            user: 'postgres',
            password: ''
          },
          mysql: {
            host: 'localhost',
            port: 3306,
            database: 'tinymon',
            user: 'root',
            password: ''
          }
        };
      }
      
      // Устанавливаем notification_providers по умолчанию, если не указано
      if (!this.settings.notification_providers) {
        this.settings.notification_providers = [];
      }

      configLogger.info('Настройки загружены:', this.settings);
      // Устанавливаем уровень логирования
      Logger.setLogLevel(this.settings.logLevel);
    } catch (err) {
      configLogger.error('Ошибка загрузки settings.json:', (err as Error).message);
      // Используем настройки по умолчанию
      this.settings = {
        bindAddress: '0.0.0.0',
        port: 3000,
        checkInterval: 60,
        timeout: 5000,
        retries: 3,
        logLevel: 'info',
        database: {
          type: 'sqlite',
          sqlite: {
            path: './monitoring.db'
          },
          postgres: {
            host: 'localhost',
            port: 5432,
            database: 'tinymon',
            user: 'postgres',
            password: ''
          },
          mysql: {
            host: 'localhost',
            port: 3306,
            database: 'tinymon',
            user: 'root',
            password: ''
          }
        },
        notification_providers: []
      };
      // Устанавливаем уровень логирования
      Logger.setLogLevel(this.settings.logLevel);
      // Создаем файл с настройками по умолчанию
      await fs.writeFile(settingsPath, JSON.stringify(this.settings, null, 2));
    }
  }

  private async loadServices(): Promise<void> {
    const servicesDir = path.join(process.cwd(), 'settings.d');
    try {
      const files = await fs.readdir(servicesDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      this.services = [];
      for (const file of jsonFiles) {
        const filePath = path.join(servicesDir, file);
        try {
          const data = await fs.readFile(filePath, 'utf8');
          const service = JSON.parse(data);
          // Валидация обязательных полей
          if (!service.name || !service.type || !service.address) {
            configLogger.warn(`Пропущен некорректный сервис в ${file}: отсутствуют обязательные поля`);
            continue;
          }
          
          // Для SSL сервисов устанавливаем значения по умолчанию
          if (service.type === 'ssl') {
            // Интервал по умолчанию: 24 часа (86400 секунд)
            if (!service.interval) {
              service.interval = 86400;
            }
            // Предупреждение по умолчанию: за 30 дней до экспирации
            if (service.warn_before === undefined) {
              service.warn_before = 30;
            }
            // Время проверки по умолчанию: 00:00
            if (!service.check_at) {
              service.check_at = '00:00';
            }
            // Проверяем формат времени
            if (service.check_at && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(service.check_at)) {
              configLogger.warn(`Некорректный формат check_at в ${file}: ${service.check_at}, используем 00:00`);
              service.check_at = '00:00';
            }
            // Адрес должен начинаться с https://
            if (!service.address.startsWith('https://')) {
              configLogger.warn(`Адрес SSL сервиса в ${file} должен начинаться с https://: ${service.address}`);
            }
          } else if (!service.interval) {
            // Для других типов interval обязателен
            configLogger.warn(`Пропущен некорректный сервис в ${file}: отсутствует interval`);
            continue;
          }
          
          // Добавляем идентификатор на основе имени файла
          service.id = path.basename(file, '.json');
          this.services.push(service as Service);
        } catch (err) {
          configLogger.error(`Ошибка чтения файла ${file}:`, (err as Error).message);
        }
      }
      configLogger.info(`Загружено сервисов: ${this.services.length}`);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      // Если папка не существует, создаем её
      if (error.code === 'ENOENT') {
        await fs.mkdir(servicesDir, { recursive: true });
        configLogger.info('Создана папка settings.d');
      } else {
        configLogger.error('Ошибка чтения папки services:', error.message);
      }
    }
  }

  getSettings(): Settings {
    return this.settings;
  }

  getServices(): Service[] {
    return this.services;
  }

  getService(id: string): Service | undefined {
    return this.services.find(s => s.id === id);
  }
}

export default new ConfigLoader();