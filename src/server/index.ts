import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import ejs from 'ejs';

import config from './utils/config';
import database from './models/database';
import scheduler from './utils/scheduler';
import notificationManager from './notifications/notification-manager';
import statusRoutes from './routes/status';
import { mainLogger } from './utils/logger';

class MonitoringServer {
  private app: express.Application;
  private server: any; // TODO: заменить на http.Server

  constructor() {
    this.app = express();
    this.server = null;
  }

  async initialize(): Promise<void> {
    // Загрузка конфигурации
    await config.load();

    // Подключение к базе данных
    await database.connect();

    // Синхронизация сервисов
    await database.syncServices(config.getServices());

    // Инициализация менеджера уведомлений
    await notificationManager.initialize();

    // Настройка middleware
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));
    
    // Определяем пути в зависимости от окружения
    const isProduction = process.env.NODE_ENV === 'production' || __dirname.includes('/dist/');
    const basePath = isProduction ? __dirname : process.cwd();
    mainLogger.info('Environment:', isProduction ? 'production' : 'development');
    mainLogger.info('Base path:', basePath);

    const publicPath = path.join(basePath, 'public');
    const viewsPath = path.join(basePath, 'views');

    mainLogger.info('Serving static files from:', publicPath);
    mainLogger.info('Directory exists?', require('fs').existsSync(publicPath));
    mainLogger.info('Views path:', viewsPath);
    mainLogger.info('Views exists?', require('fs').existsSync(viewsPath));
    
    this.app.use(express.static(publicPath));

    // Настройка шаблонизатора
    this.app.set('view engine', 'ejs');
    this.app.set('views', viewsPath);
    this.app.engine('ejs', ejs.renderFile);

    // Маршруты
    this.app.use('/', statusRoutes);

    // Обработка ошибок 404
    this.app.use((req, res) => {
      mainLogger.warn('404 Not Found:', req.method, req.url);
      res.status(404).json({ error: 'Не найдено' });
    });

    // Обработка ошибок
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      mainLogger.error('Ошибка сервера:', err.stack);
      res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    });
  }

  start(): void {
    const settings = config.getSettings();
    const port = settings.port;
    const bindAddress = settings.bindAddress;

    this.server = this.app.listen(port, bindAddress, () => {
      mainLogger.info(`Сервер мониторинга запущен на http://${bindAddress}:${port}`);
      mainLogger.info('Используемые настройки:', settings);
    });

    // Запуск планировщика проверок
    scheduler.start();

    // Обработка корректного завершения
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  stop(): void {
    mainLogger.info('Остановка сервера мониторинга...');
    scheduler.stopAll();
    notificationManager.shutdown().catch(err => {
      mainLogger.error('Ошибка остановки менеджера уведомлений:', err);
    });
    database.close();
    if (this.server) {
      this.server.close(() => {
        mainLogger.info('Сервер остановлен');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }
}

// Запуск приложения
(async (): Promise<void> => {
  try {
    const server = new MonitoringServer();
    await server.initialize();
    server.start();
  } catch (err) {
    mainLogger.error('Не удалось запустить сервер:', err);
    process.exit(1);
  }
})();