import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import path from 'path';
import ejs from 'ejs';

import config from './utils/config';
import database from './models/database';
import scheduler from './utils/scheduler';
import notificationManager from './notifications/notification-manager';
import statusRoutes from './routes/status';
import Logger, { mainLogger } from './utils/logger';
import * as auth from './utils/auth';

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
    this.app.use(cookieParser());
    
    // Определяем пути в зависимости от окружения
    const isProduction = process.env.NODE_ENV === 'production' || __dirname.includes('/dist/');
    const basePath = isProduction ? __dirname : process.cwd();
    mainLogger.info('Environment:', isProduction ? 'production' : 'development');
    mainLogger.info('Base path:', basePath);

    const publicPath = path.join(basePath, 'public');
    const viewsPath = isProduction ? path.join(basePath, 'views') : path.join(__dirname, 'views');

    mainLogger.info('Serving static files from:', publicPath);
    mainLogger.info('Directory exists?', require('fs').existsSync(publicPath));
    mainLogger.info('Views path:', viewsPath);
    mainLogger.info('Views exists?', require('fs').existsSync(viewsPath));

    
    // Middleware аутентификации (перед статикой, но с исключениями для статических путей)
    const authLogger = Logger.withPrefix('Auth');
    this.app.use((req, res, next) => {
      authLogger.debug(`Запрос: ${req.method} ${req.path}, IP: ${req.ip}`);
      // Если пользователей нет, аутентификация не требуется
      if (!auth.hasUsers()) {
        authLogger.debug(`Аутентификация не требуется (нет пользователей): ${req.method} ${req.path}`);
        return next();
      }

      // Пути, не требующие аутентификации
      const publicPaths = ['/login', '/api/login', '/api/logout', '/logout'];
      const staticPrefixes = ['/css/', '/js/', '/public/'];
      if (publicPaths.includes(req.path) || staticPrefixes.some(prefix => req.path.startsWith(prefix))) {
        authLogger.debug(`Публичный путь: ${req.path}, пропускаем аутентификацию`);
        return next();
      }

      // Получение токена из куки или заголовка
      let token = req.cookies?.session_token || req.headers['x-session-token'] as string;

      // Если токен не найден, проверяем Authorization header
      if (!token && req.headers.authorization?.startsWith('Bearer ')) {
        token = req.headers.authorization.substring(7);
      }

      if (!token) {
        // Для API запросов возвращаем 401
        if (req.path.startsWith('/api/')) {
          authLogger.warn(`Отказ в доступе (нет токена) API: ${req.method} ${req.path} от ${req.ip}`);
          return res.status(401).json({ error: 'Требуется аутентификация' });
        }
        // Для веб-страниц редирект на страницу логина
        authLogger.warn(`Перенаправление на логин (нет токена): ${req.method} ${req.path} от ${req.ip}`);
        return res.redirect('/login');
      }

      // Проверка токена
      if (!auth.validateSession(token)) {
        // Удаляем невалидную куку
        res.clearCookie('session_token');
        authLogger.warn(`Недействительная сессия: ${req.method} ${req.path} от ${req.ip}`);

        if (req.path.startsWith('/api/')) {
          return res.status(401).json({ error: 'Недействительная сессия' });
        }
        return res.redirect('/login');
      }

      // Получаем пользователя из сессии
      const username = auth.getSessionUser(token);
      if (!username) {
        authLogger.warn(`Сессия без пользователя: ${req.method} ${req.path} от ${req.ip}`);
        if (req.path.startsWith('/api/')) {
          return res.status(401).json({ error: 'Ошибка сессии' });
        }
        return res.redirect('/login');
      }

      // Логируем успешный доступ
      authLogger.debug(`Доступ разрешен: ${username} -> ${req.method} ${req.path} от ${req.ip}`);
      // Добавляем пользователя в объект запроса
      (req as any).user = username;
      return next();
    });

    // Обслуживание статических файлов (после middleware аутентификации)
    this.app.use(express.static(publicPath));

    // Настройка шаблонизатора
    this.app.set('view engine', 'ejs');
    this.app.set('views', viewsPath);
    this.app.engine('ejs', ejs.renderFile);

    // Маршруты аутентификации
    this.app.post('/api/login', (req, res) => {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: 'Не указано имя пользователя или пароль' });
      }

      const result = auth.authenticate(username, password);
      if (!result.success) {
        return res.status(401).json({ error: result.error });
      }

      const session = auth.createSession(username);
      
      // Устанавливаем куку
      res.cookie('session_token', session.token, {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 часа
        sameSite: 'strict'
      });

      return res.json({ success: true, user: username });
    });

    this.app.post('/api/logout', (req, res) => {
      const token = req.cookies?.session_token || req.headers['x-session-token'] as string;
      if (token) {
        auth.logout(token);
        res.clearCookie('session_token');
      }
      return res.json({ success: true });
    });

    this.app.get('/login', (req, res) => {
      // Если уже авторизован, редирект на главную
      const token = req.cookies?.session_token;
      if (token && auth.validateSession(token)) {
        return res.redirect('/');
      }
      return res.render('login', { error: null });
    });

    this.app.get('/logout', (req, res) => {
      const token = req.cookies?.session_token;
      if (token) {
        auth.logout(token);
        res.clearCookie('session_token');
      }
      return res.redirect('/login');
    });

    // Основные маршруты
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