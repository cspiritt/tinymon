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
  private server: any; // TODO: replace with http.Server

  constructor() {
    this.app = express();
    this.server = null;
    
  }

  async initialize(): Promise<void> {
    // Load configuration
    await config.load();


    // Connect to database
    await database.connect();

    // Sync services
    await database.syncServices(config.getServices());

    // Initialize notification manager
    await notificationManager.initialize();

    // Setup middleware
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));
    this.app.use(cookieParser());
    
    // Determine paths based on environment
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

    
    // Auth middleware (before static, with exceptions for static paths)
    const authLogger = Logger.withPrefix('Auth');
    this.app.use((req, res, next) => {
      authLogger.debug(`Request: ${req.method} ${req.path}, IP: ${req.ip}`);
      // If no users exist, authentication is not required
      if (!auth.hasUsers()) {
        authLogger.debug(`Authentication not required (no users): ${req.method} ${req.path}`);
        return next();
      }

      // Paths that don't require authentication
      const publicPaths = ['/login', '/api/login', '/api/logout', '/logout'];
      const staticPrefixes = ['/css/', '/js/', '/public/'];
      if (publicPaths.includes(req.path) || staticPrefixes.some(prefix => req.path.startsWith(prefix))) {
        authLogger.debug(`Public path: ${req.path}, skipping authentication`);
        return next();
      }

      // Get token from cookie or header
      let token = req.cookies?.session_token || req.headers['x-session-token'] as string;

      // If token not found, check Authorization header
      if (!token && req.headers.authorization?.startsWith('Bearer ')) {
        token = req.headers.authorization.substring(7);
      }

      if (!token) {
        // For API requests, return 401
        if (req.path.startsWith('/api/')) {
          authLogger.warn(`Access denied (no token) API: ${req.method} ${req.path} from ${req.ip}`);
          return res.status(401).json({ error: 'Authentication required' });
        }
        // For web pages, redirect to login page
        authLogger.warn(`Redirecting to login (no token): ${req.method} ${req.path} from ${req.ip}`);
        return res.redirect('/login');
      }

      // Validate token
      if (!auth.validateSession(token)) {
        // Remove invalid cookie
        res.clearCookie('session_token');
        authLogger.warn(`Invalid session: ${req.method} ${req.path} from ${req.ip}`);

        if (req.path.startsWith('/api/')) {
          return res.status(401).json({ error: 'Invalid session' });
        }
        return res.redirect('/login');
      }

      // Get user from session
      const username = auth.getSessionUser(token);
      if (!username) {
        authLogger.warn(`Session without user: ${req.method} ${req.path} from ${req.ip}`);
        if (req.path.startsWith('/api/')) {
          return res.status(401).json({ error: 'Session error' });
        }
        return res.redirect('/login');
      }

      // Log successful access
      authLogger.debug(`Access granted: ${username} -> ${req.method} ${req.path} from ${req.ip}`);
      // Attach user to request object
      (req as any).user = username;
      return next();
    });

    // Serve static files (after auth middleware)
    this.app.use(express.static(publicPath));

    // Configure template engine
    this.app.set('view engine', 'ejs');
    this.app.set('views', viewsPath);
    this.app.engine('ejs', ejs.renderFile);

    // Auth routes
    this.app.post('/api/login', (req, res) => {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: 'Username or password not specified' });
      }

      const result = auth.authenticate(username, password);
      if (!result.success) {
        return res.status(401).json({ error: result.error });
      }

      const session = auth.createSession(username);
      
      // Set cookie
      res.cookie('session_token', session.token, {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
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
      // If already authenticated, redirect to main page
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

    // Main routes
    this.app.use('/', statusRoutes);

    // 404 error handler
    this.app.use((req, res) => {
      mainLogger.warn('404 Not Found:', req.method, req.url);
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      mainLogger.error('Server error:', err.stack);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  start(): void {
    const settings = config.getSettings();
    const port = settings.port;
    const bindAddress = settings.bindAddress;

    this.server = this.app.listen(port, bindAddress, () => {
      mainLogger.info(`Monitoring server started on http://${bindAddress}:${port}`);
      mainLogger.info('Using settings:', settings);
    });

    // Start scheduler
    scheduler.start();

    // Handle graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  stop(): void {
    mainLogger.info('Stopping monitoring server...');
    scheduler.stopAll();
    notificationManager.shutdown().catch(err => {
      mainLogger.error('Error stopping notification manager:', err);
    });
    database.close();
    if (this.server) {
      this.server.close(() => {
        mainLogger.info('Server stopped');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }
}

// Start application
(async (): Promise<void> => {
  try {
    const server = new MonitoringServer();
    await server.initialize();
    server.start();
  } catch (err) {
    mainLogger.error('Failed to start server:', err);
    process.exit(1);
  }
})();