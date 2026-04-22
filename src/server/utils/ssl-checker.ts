import tls from 'tls';
import { URL } from 'url';
import { Service, CheckResult, SSLCertificateInfo } from '../types';

/**
 * Checks SSL certificate for the specified URL
 * @param service Service of type 'ssl'
 * @returns Check result
 */
export async function checkSSLCertificate(service: Service): Promise<CheckResult> {
  const startTime = Date.now();
  let responseTime: number | null = null;
  let errorMessage: string | null = null;
  let success = false;
  let sslDaysUntilExpiry: number | undefined;
  let sslExpiryDate: Date | undefined;

  try {
    // Parse URL
    let url: URL;
    try {
      url = new URL(service.address);
    } catch (err) {
      throw new Error(`Invalid URL: ${service.address}`);
    }

    const hostname = url.hostname;
    const port = parseInt(url.port) || 443;

    // Connect to server to get certificate
    const certificate = await getCertificate(hostname, port);
    
    // Calculate days until expiration
    const now = new Date();
    const expiryDate = certificate.valid_to;
    const daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // Determine status based on days until expiration and warn_before
    const warnBefore = service.warn_before || 30;
    let status: 'OK' | 'WARNING' | 'ERROR' | 'unknown' = 'unknown';

    if (daysUntilExpiry <= 0) {
      status = 'ERROR';
      success = false;
      errorMessage = `Certificate expired ${Math.abs(daysUntilExpiry)} days ago`;
    } else if (daysUntilExpiry <= warnBefore) {
      status = 'WARNING';
      success = true; // Certificate is still valid but will expire soon
      errorMessage = `Certificate will expire in ${daysUntilExpiry} days`;
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
      failureCount: 0, // Will be updated by calling code
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
      failureCount: 0, // Will be updated by calling code
      status: 'ERROR'
    };
  }
}

/**
 * Gets SSL certificate from specified host and port
 */
async function getCertificate(hostname: string, port: number): Promise<SSLCertificateInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: hostname,
      port: port,
      servername: hostname,
      rejectUnauthorized: false, // Do not reject invalid certificates
      timeout: 10000 // 10 second timeout
    }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      
      if (!cert || !cert.valid_from || !cert.valid_to) {
        reject(new Error('Failed to get certificate'));
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
      reject(new Error(`Connection error: ${err.message}`));
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Connection timeout'));
    });
  });
}

/**
 * Checks if SSL service check should be performed now
 * @param service Service of type 'ssl'
 * @param lastCheckTimestamp Time of last check (timestamp in seconds)
 * @returns true if check should be performed
 */
export function shouldCheckSSLCertificate(service: Service, lastCheckTimestamp: number): boolean {
  const now = new Date();
  const lastCheck = new Date(lastCheckTimestamp * 1000);
  
  // If check was never performed, perform it
  if (lastCheckTimestamp === 0) {
    return true;
  }

  // Check if more than 24 hours have passed since last check
  const hoursSinceLastCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60);
  if (hoursSinceLastCheck >= 24) {
    // Check check_at time
    const checkAt = service.check_at || '00:00';
    const [checkHour, checkMinute] = checkAt.split(':').map(Number);

    // Create date for today's check
    const todayCheck = new Date(now);
    todayCheck.setHours(checkHour, checkMinute, 0, 0);

    // If today's check should have already been performed but wasn't
    if (now >= todayCheck && lastCheck < todayCheck) {
      return true;
    }

    // If more than 24 hours have passed, perform regardless of time
    // (in case of missed checks)
    return true;
  }
  
  return false;
}