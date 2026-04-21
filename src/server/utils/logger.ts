/**
 * Утилита для логирования с датой и временем
 */

export class Logger {
  /**
   * Форматирование даты с миллисекундами
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
   * Форматирование строки лога
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
   * Лог уровня info
   */
  static info(message: string, ...args: any[]): void {
    console.log(Logger.formatLog('INFO', message, ...args));
  }

  /**
   * Лог уровня warn
   */
  static warn(message: string, ...args: any[]): void {
    console.warn(Logger.formatLog('WARN', message, ...args));
  }

  /**
   * Лог уровня error
   */
  static error(message: string, ...args: any[]): void {
    console.error(Logger.formatLog('ERROR', message, ...args));
  }

  /**
   * Лог уровня debug (только при включенном debug режиме)
   */
  static debug(message: string, ...args: any[]): void {
    // Можно добавить проверку на уровень логирования из конфигурации
    console.debug(Logger.formatLog('DEBUG', message, ...args));
  }

  /**
   * Логирование с кастомным префиксом
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

// Экспортируем готовые логгеры для разных модулей
export const mainLogger = Logger.withPrefix('Main');
export const dbLogger = Logger.withPrefix('DB');
export const checkerLogger = Logger.withPrefix('Checker');
export const schedulerLogger = Logger.withPrefix('Scheduler');
export const notificationLogger = Logger.withPrefix('Notification');
export const sslCheckerLogger = Logger.withPrefix('SSL-Checker');
export const tcpPingLogger = Logger.withPrefix('TCP-Ping');
export const configLogger = Logger.withPrefix('Config');
export const routesLogger = Logger.withPrefix('Routes');

// Экспортируем синглтон для глобального использования
export default Logger;