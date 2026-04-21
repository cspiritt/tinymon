import tls from 'tls';
import { URL } from 'url';
import { Service, CheckResult, SSLCertificateInfo } from '../types';

/**
 * Проверяет SSL сертификат по указанному URL
 * @param service Сервис с типом 'ssl'
 * @returns Результат проверки
 */
export async function checkSSLCertificate(service: Service): Promise<CheckResult> {
  const startTime = Date.now();
  let responseTime: number | null = null;
  let errorMessage: string | null = null;
  let success = false;
  let sslDaysUntilExpiry: number | undefined;
  let sslExpiryDate: Date | undefined;

  try {
    // Парсим URL
    let url: URL;
    try {
      url = new URL(service.address);
    } catch (err) {
      throw new Error(`Некорректный URL: ${service.address}`);
    }

    const hostname = url.hostname;
    const port = parseInt(url.port) || 443;

    // Подключаемся к серверу для получения сертификата
    const certificate = await getCertificate(hostname, port);
    
    // Вычисляем дни до истечения срока
    const now = new Date();
    const expiryDate = certificate.valid_to;
    const daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    // Определяем статус на основе дней до истечения и warn_before
    const warnBefore = service.warn_before || 30;
    let status: 'OK' | 'WARNING' | 'ERROR' | 'unknown' = 'unknown';
    
    if (daysUntilExpiry <= 0) {
      status = 'ERROR';
      success = false;
      errorMessage = `Сертификат истёк ${Math.abs(daysUntilExpiry)} дней назад`;
    } else if (daysUntilExpiry <= warnBefore) {
      status = 'WARNING';
      success = true; // Сертификат ещё действителен, но скоро истечёт
      errorMessage = `Сертификат истечёт через ${daysUntilExpiry} дней`;
    } else {
      status = 'OK';
      success = true;
    }
    
    responseTime = Date.now() - startTime;
    sslDaysUntilExpiry = daysUntilExpiry;
    sslExpiryDate = expiryDate;
    
    return {
      serviceId: service.id,
      serviceName: service.name,
      success,
      responseTime,
      errorMessage,
      failureCount: 0, // Будет обновлено вызывающим кодом
      status,
      ssl_days_until_expiry: sslDaysUntilExpiry,
      ssl_expiry_date: sslExpiryDate
    };
    
  } catch (err) {
    responseTime = Date.now() - startTime;
    errorMessage = (err as Error).message;
    
    return {
      serviceId: service.id,
      serviceName: service.name,
      success: false,
      responseTime,
      errorMessage,
      failureCount: 0, // Будет обновлено вызывающим кодом
      status: 'ERROR'
    };
  }
}

/**
 * Получает SSL сертификат с указанного хоста и порта
 */
async function getCertificate(hostname: string, port: number): Promise<SSLCertificateInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: hostname,
      port: port,
      servername: hostname,
      rejectUnauthorized: false, // Не отклонять невалидные сертификаты
      timeout: 10000 // 10 секунд таймаут
    }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      
      if (!cert || !cert.valid_from || !cert.valid_to) {
        reject(new Error('Не удалось получить сертификат'));
        return;
      }
      
      const validFrom = new Date(cert.valid_from);
      const validTo = new Date(cert.valid_to);
      const now = new Date();
      const daysUntilExpiry = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      resolve({
        valid_from: validFrom,
        valid_to: validTo,
        issuer: cert.issuer ? JSON.stringify(cert.issuer) : 'Unknown',
        subject: cert.subject ? JSON.stringify(cert.subject) : 'Unknown',
        days_until_expiry: daysUntilExpiry
      });
    });
    
    socket.on('error', (err) => {
      reject(new Error(`Ошибка подключения: ${err.message}`));
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Таймаут подключения'));
    });
  });
}

/**
 * Проверяет, нужно ли выполнить проверку SSL сервиса сейчас
 * @param service Сервис с типом 'ssl'
 * @param lastCheckTimestamp Время последней проверки (timestamp в секундах)
 * @returns true, если нужно выполнить проверку
 */
export function shouldCheckSSLCertificate(service: Service, lastCheckTimestamp: number): boolean {
  const now = new Date();
  const lastCheck = new Date(lastCheckTimestamp * 1000);
  
  // Если проверка никогда не выполнялась, выполняем
  if (lastCheckTimestamp === 0) {
    return true;
  }
  
  // Проверяем, прошло ли более 24 часов с последней проверки
  const hoursSinceLastCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60);
  if (hoursSinceLastCheck >= 24) {
    // Проверяем время check_at
    const checkAt = service.check_at || '00:00';
    const [checkHour, checkMinute] = checkAt.split(':').map(Number);
    
    // Создаем дату для сегодняшней проверки
    const todayCheck = new Date(now);
    todayCheck.setHours(checkHour, checkMinute, 0, 0);
    
    // Если сегодняшняя проверка уже должна была выполниться, но не выполнена
    if (now >= todayCheck && lastCheck < todayCheck) {
      return true;
    }
    
    // Если прошло более 24 часов, выполняем независимо от времени
    // (на случай пропущенных проверок)
    return true;
  }
  
  return false;
}