import express, { Request, Response, Router } from 'express';
import database from '../models/database';
import config from '../utils/config';
import checker from '../utils/checker';

const router: Router = express.Router();

// Главная страница - статус всех сервисов
router.get('/', async (req: Request, res: Response) => {
  try {
    const services = await database.getAllServices();

    // Добавляем вычисляемый статус для каждого сервиса
    const servicesWithStatus = services.map(service => {
      let status = 'unknown';
      if (service.failure_count === 0) {
        status = 'OK';
      } else if (service.failure_count < 3) {
        status = 'WARNING';
      } else {
        status = 'ERROR';
      }

      return {
        ...service,
        status,
        lastCheck: service.last_check ? new Date(service.last_check * 1000).toISOString() : null
      };
    });

    res.render('status', {
      title: 'TinyMon - Мониторинг сервисов',
      services: servicesWithStatus,
      total: services.length,
      okCount: servicesWithStatus.filter(s => s.status === 'OK').length,
      warningCount: servicesWithStatus.filter(s => s.status === 'WARNING').length,
      errorCount: servicesWithStatus.filter(s => s.status === 'ERROR').length
    });
  } catch (err) {
    console.error('Ошибка при получении сервисов:', err);
    res.status(500).render('error', { message: 'Ошибка при получении данных' });
  }
});

// JSON API для получения статуса всех сервисов
router.get('/api/status', async (req: Request, res: Response) => {
  try {
    const services = await database.getAllServices();

    const result = services.map(service => {
      let status = 'unknown';
      if (service.failure_count === 0) {
        status = 'OK';
      } else if (service.failure_count < 3) {
        status = 'WARNING';
      } else {
        status = 'ERROR';
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
        createdAt: service.created_at
      };
    });

    res.json({
      success: true,
      data: result,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('Ошибка API статуса:', err);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

// API для получения истории проверок конкретного сервиса
router.get('/api/service/:id/checks', async (req: Request, res: Response) => {
  const serviceId = req.params.id as string;
  const limit = parseInt(req.query.limit as string) || 10;

  try {
    const service = await database.getService(serviceId);
    if (!service) {
      return res.status(404).json({ error: 'Сервис не найден' });
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
    console.error('Ошибка при получении истории проверок:', err);
    return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

// API для принудительной проверки сервиса
router.post('/api/service/:id/check', async (req: Request, res: Response) => {
  const serviceId = req.params.id as string;
  const service = config.getService(serviceId);

  if (!service) {
    return res.status(404).json({ error: 'Сервис не найден в конфигурации' });
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

// API для получения статистики
router.get('/api/stats', async (req: Request, res: Response) => {
  const period = parseInt(req.query.period as string) || 24; // часы

  try {
    const stats = await database.getStats(period);
    res.json({
      success: true,
      periodHours: period,
      stats: stats
    });
  } catch (err) {
    console.error('Ошибка при получении статистики:', err);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

export default router;