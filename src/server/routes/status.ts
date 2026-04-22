import express, { Request, Response, Router } from 'express';
import database from '../models/database';
import config from '../utils/config';
import checker from '../utils/checker';
import { ServiceGroup } from '../types';
import { routesLogger } from '../utils/logger';

const router: Router = express.Router();

/**
 * Groups services by groups
 */
function groupServices(services: any[]): ServiceGroup[] {
  const groupsMap = new Map<string, any[]>();
  
  // Distribute services by groups
  services.forEach(service => {
    const groupName = service.group || 'Ungrouped';
    if (!groupsMap.has(groupName)) {
      groupsMap.set(groupName, []);
    }
    groupsMap.get(groupName)!.push(service);
  });
  
  // Convert to ServiceGroup array
  const groups: ServiceGroup[] = [];
  groupsMap.forEach((services, groupName) => {
    const okCount = services.filter(s => s.status === 'OK').length;
    const warningCount = services.filter(s => s.status === 'WARNING').length;
    const errorCount = services.filter(s => s.status === 'ERROR').length;
    const allOk = errorCount === 0 && warningCount === 0;
    
    groups.push({
      name: groupName,
      services,
      allOk,
      okCount,
      warningCount,
      errorCount
    });
  });
  
  // Sort groups: errors first, then warnings, then OK
  groups.sort((a, b) => {
    if (a.errorCount !== b.errorCount) return b.errorCount - a.errorCount;
    if (a.warningCount !== b.warningCount) return b.warningCount - a.warningCount;
    return a.name.localeCompare(b.name);
  });
  
  return groups;
}

// Main page - status of all services
router.get('/', async (req: Request, res: Response) => {
  try {
    const services = await database.getAllServices();
    const user = (req as any).user;

    // Add calculated status for each service
    const servicesWithStatus = services.map(service => {
      let status = 'unknown';
      
      // For SSL services, consider certificate expiration days
      if (service.type === 'ssl') {
        // If there are connection errors, use standard logic
        if (service.failure_count > 0) {
          if (service.failure_count < 3) {
            status = 'WARNING';
          } else {
            status = 'ERROR';
          }
        } else if (service.ssl_days_until_expiry !== null) {
          // Determine status based on days until expiration
          const warnBefore = service.warn_before || 30;
          if (service.ssl_days_until_expiry <= 0) {
            status = 'ERROR';
          } else if (service.ssl_days_until_expiry <= warnBefore) {
            status = 'WARNING';
          } else {
            status = 'OK';
          }
        } else {
          // Certificate not yet checked
          status = 'unknown';
        }
      } else {
        // Standard logic for HTTP/IP services
        if (service.failure_count === 0) {
          status = 'OK';
        } else if (service.failure_count < 3) {
          status = 'WARNING';
        } else {
          status = 'ERROR';
        }
      }

      return {
        ...service,
        status,
        lastCheck: service.last_check ? new Date(service.last_check * 1000).toISOString() : null
      };
    });

    const groups = groupServices(servicesWithStatus);
    
    res.render('status', {
      title: 'TinyMon - Service Monitoring',
      services: servicesWithStatus, // for backward compatibility
      groups: groups,
      total: services.length,
      okCount: servicesWithStatus.filter(s => s.status === 'OK').length,
      warningCount: servicesWithStatus.filter(s => s.status === 'WARNING').length,
      errorCount: servicesWithStatus.filter(s => s.status === 'ERROR').length,
      user: user
    });
  } catch (err) {
    routesLogger.error('Error getting services:', err);
    res.status(500).render('error', { message: 'Error getting data' });
  }
});

// JSON API for getting status of all services
router.get('/api/status', async (req: Request, res: Response) => {
  try {
    const services = await database.getAllServices();

    const result = services.map(service => {
      let status = 'unknown';
      
      // For SSL services, consider certificate expiration days
      if (service.type === 'ssl') {
        // If there are connection errors, use standard logic
        if (service.failure_count > 0) {
          if (service.failure_count < 3) {
            status = 'WARNING';
          } else {
            status = 'ERROR';
          }
        } else if (service.ssl_days_until_expiry !== null) {
          // Determine status based on days until expiration
          const warnBefore = service.warn_before || 30;
          if (service.ssl_days_until_expiry <= 0) {
            status = 'ERROR';
          } else if (service.ssl_days_until_expiry <= warnBefore) {
            status = 'WARNING';
          } else {
            status = 'OK';
          }
        } else {
          // Certificate not yet checked
          status = 'unknown';
        }
      } else {
        // Standard logic for HTTP/IP services
        if (service.failure_count === 0) {
          status = 'OK';
        } else if (service.failure_count < 3) {
          status = 'WARNING';
        } else {
          status = 'ERROR';
        }
      }

      return {
        id: service.id,
        name: service.name,
        type: service.type,
        address: service.address,
        interval: service.interval,
        failureCount: service.failure_count,
        status: status,
        lastCheck: service.last_check,
        lastStatus: service.last_status,
        createdAt: service.created_at,
        group: service.group,
        warn_before: service.warn_before,
        check_at: service.check_at,
        ssl_days_until_expiry: service.ssl_days_until_expiry,
        ssl_expiry_date: service.ssl_expiry_date
      };
    });

    res.json({
      success: true,
      data: result,
      timestamp: Date.now()
    });
  } catch (err) {
    routesLogger.error('Status API error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// API for getting check history of specific service
router.get('/api/service/:id/checks', async (req: Request, res: Response) => {
  const serviceId = req.params.id as string;
  const limit = parseInt(req.query.limit as string) || 10;

  try {
    const service = await database.getService(serviceId);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const checks = await database.getServiceChecks(serviceId, limit);
    return res.json({
      success: true,
      data: {
        service: {
          id: service.id,
          name: service.name
        },
        checks: checks.map(check => ({
          id: check.id,
          status: check.status,
          responseTime: check.response_time,
          errorMessage: check.error_message,
          checkedAt: check.checked_at
        }))
      }
    });
  } catch (err) {
    routesLogger.error('Error getting check history:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// API for forced service check
router.post('/api/service/:id/check', async (req: Request, res: Response) => {
  const serviceId = req.params.id as string;
  const service = config.getService(serviceId);

  if (!service) {
    return res.status(404).json({ error: 'Service not found in configuration' });
  }

  try {
    const result = await checker.checkService(service);
    return res.json({
      success: true,
      result
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: (err as Error).message
    });
  }
});

// API for getting statistics
router.get('/api/stats', async (req: Request, res: Response) => {
  const period = parseInt(req.query.period as string) || 24; // hours

  try {
    const stats = await database.getStats(period);
    res.json({
      success: true,
      periodHours: period,
      stats: stats
    });
  } catch (err) {
    routesLogger.error('Error getting statistics:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;