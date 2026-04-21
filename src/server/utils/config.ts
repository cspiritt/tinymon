import { promises as fs } from 'fs';
import path from 'path';
import { Settings, Service } from '../types';

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
        console.log('Обновление структуры database для обратной совместимости');
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

      console.log('Настройки загружены:', this.settings);
    } catch (err) {
      console.error('Ошибка загрузки settings.json:', (err as Error).message);
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
        }
      };
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
          if (!service.name || !service.type || !service.address || !service.interval) {
            console.warn(`Пропущен некорректный сервис в ${file}: отсутствуют обязательные поля`);
            continue;
          }
          // Добавляем идентификатор на основе имени файла
          service.id = path.basename(file, '.json');
          this.services.push(service as Service);
        } catch (err) {
          console.error(`Ошибка чтения файла ${file}:`, (err as Error).message);
        }
      }
      console.log(`Загружено сервисов: ${this.services.length}`);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      // Если папка не существует, создаем её
      if (error.code === 'ENOENT') {
        await fs.mkdir(servicesDir, { recursive: true });
        console.log('Создана папка settings.d');
      } else {
        console.error('Ошибка чтения папки services:', error.message);
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