/**
 * Utility for logging with date and time
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export class Logger {
  private static currentLogLevel: LogLevel = 'info'; // default level
  
  /**
   * Setting logging level
   */
  static setLogLevel(level: LogLevel): void {
    this.currentLogLevel = level;
  }
  
  /**
   * Getting current logging level
   */
  static getLogLevel(): LogLevel {
    return this.currentLogLevel;
  }
  
  /**
   * Check if log of this level should be written
   */
  private static shouldLog(level: LogLevel): boolean {
    const levelPriority: Record<LogLevel, number> = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
    
    const currentPriority = levelPriority[this.currentLogLevel];
    const messagePriority = levelPriority[level];
    
    return messagePriority <= currentPriority;
  }
  /**
   * Formatting date with milliseconds
   */
  private static formatDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
  }

  /**
   * Formatting log string
   */
  private static formatLog(level: string, message: string, ...args: any[]): string {
    const timestamp = Logger.formatDate();
    const formattedMessage = typeof message === 'string' ? message : JSON.stringify(message);
    
    let logLine = `[${timestamp}] [${level}] ${formattedMessage}`;
    
    if (args.length > 0) {
      const formattedArgs = args.map(arg => 
        typeof arg === 'string' ? arg : JSON.stringify(arg)
      ).join(' ');
      logLine += ' ' + formattedArgs;
    }
    
    return logLine;
  }

  /**
   * Info level log
   */
  static info(message: string, ...args: any[]): void {
    if (!this.shouldLog('info')) return;
    console.log(Logger.formatLog('INFO', message, ...args));
  }

  /**
   * Warn level log
   */
  static warn(message: string, ...args: any[]): void {
    if (!this.shouldLog('warn')) return;
    console.warn(Logger.formatLog('WARN', message, ...args));
  }

  /**
   * Error level log
   */
  static error(message: string, ...args: any[]): void {
    if (!this.shouldLog('error')) return;
    console.error(Logger.formatLog('ERROR', message, ...args));
  }

  /**
   * Debug level log (only when debug mode is enabled)
   */
  static debug(message: string, ...args: any[]): void {
    if (!this.shouldLog('debug')) return;
    console.debug(Logger.formatLog('DEBUG', message, ...args));
  }

  /**
   * Logging with custom prefix
   */
  static withPrefix(prefix: string) {
    return {
      info: (message: string, ...args: any[]) => 
        Logger.info(`[${prefix}] ${message}`, ...args),
      warn: (message: string, ...args: any[]) => 
        Logger.warn(`[${prefix}] ${message}`, ...args),
      error: (message: string, ...args: any[]) => 
        Logger.error(`[${prefix}] ${message}`, ...args),
      debug: (message: string, ...args: any[]) => 
        Logger.debug(`[${prefix}] ${message}`, ...args)
    };
  }
}

// Export ready loggers for different modules
export const mainLogger = Logger.withPrefix('Main');
export const dbLogger = Logger.withPrefix('DB');
export const checkerLogger = Logger.withPrefix('Checker');
export const schedulerLogger = Logger.withPrefix('Scheduler');
export const notificationLogger = Logger.withPrefix('Notification');
export const sslCheckerLogger = Logger.withPrefix('SSL-Checker');
export const tcpPingLogger = Logger.withPrefix('TCP-Ping');
export const configLogger = Logger.withPrefix('Config');
export const routesLogger = Logger.withPrefix('Routes');

// Export singleton for global use
export default Logger;