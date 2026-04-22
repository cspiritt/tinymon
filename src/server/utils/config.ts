import { promises as fs } from 'fs';
import path from 'path';
import { Settings, Service, User } from '../types';
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

      // Backward compatibility: if database is a string, convert to new structure
      if (typeof this.settings.database === 'string') {
        configLogger.info('Updating database structure for backward compatibility');
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
      
      // Set notification_providers default if not specified
      if (!this.settings.notification_providers) {
        this.settings.notification_providers = [];
      }

      // Set users default if not specified
      if (!this.settings.users) {
        this.settings.users = [];
      }

      configLogger.info('Settings loaded:', this.settings);
      configLogger.info(`Users loaded: ${this.settings.users.length}`);
      // Set logging level
      Logger.setLogLevel(this.settings.logLevel);
    } catch (err) {
      configLogger.error('Error loading settings.json:', (err as Error).message);
      // Use default settings
      this.settings = {
        bindAddress: '0.0.0.0',
        port: 3000,
        checkInterval: 60,
        timeout: 5000,
        retries: 3,
        logLevel: 'info',
        dateFormat: 'en-US', // Default date format
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
        users: [],
        notification_providers: []
      };
      // Set logging level
      Logger.setLogLevel(this.settings.logLevel);
      // Create file with default settings
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
          // Validation of required fields
          if (!service.name || !service.type || !service.address) {
            configLogger.warn(`Skipped invalid service in ${file}: missing required fields`);
            continue;
          }
          
          // Set default values for SSL services
          if (service.type === 'ssl') {
            // Default interval: 24 hours (86400 seconds)
            if (!service.interval) {
              service.interval = 86400;
            }
            // Default warning: 30 days before expiration
            if (service.warn_before === undefined) {
              service.warn_before = 30;
            }
            // Default check time: 00:00
            if (!service.check_at) {
              service.check_at = '00:00';
            }
            // Validate time format
            if (service.check_at && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(service.check_at)) {
              configLogger.warn(`Invalid check_at format in ${file}: ${service.check_at}, using 00:00`);
              service.check_at = '00:00';
            }
            // Address must start with https://
            if (!service.address.startsWith('https://')) {
              configLogger.warn(`SSL service address in ${file} must start with https://: ${service.address}`);
            }
          } else if (!service.interval) {
            // For other types, interval is required
            configLogger.warn(`Skipped invalid service in ${file}: missing interval`);
            continue;
          }
          
          // Add identifier based on file name
          service.id = path.basename(file, '.json');
          this.services.push(service as Service);
        } catch (err) {
          configLogger.error(`Error reading file ${file}:`, (err as Error).message);
        }
      }
      configLogger.info(`Services loaded: ${this.services.length}`);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      // If folder doesn't exist, create it
      if (error.code === 'ENOENT') {
        await fs.mkdir(servicesDir, { recursive: true });
        configLogger.info('Created folder settings.d');
      } else {
        configLogger.error('Error reading services folder:', error.message);
      }
    }
  }

  getSettings(): Settings {
    return this.settings;
  }

  getUsers(): User[] {
    return this.settings.users || [];
  }

  getServices(): Service[] {
    return this.services;
  }

  getService(id: string): Service | undefined {
    return this.services.find(s => s.id === id);
  }
}

export default new ConfigLoader();