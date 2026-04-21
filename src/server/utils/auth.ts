/**
 * Модуль аутентификации и управления сессиями
 */

import bcrypt from 'bcryptjs';
import { AuthResult, SessionData, User } from '../types';
import config from './config';
import Logger from './logger';

const authLogger = Logger.withPrefix('Auth');

// Хранилище активных сессий: token -> SessionData
const sessions = new Map<string, SessionData>();

// Время жизни сессии в миллисекундах (24 часа)
const SESSION_TTL = 24 * 60 * 60 * 1000;

// Очистка устаревших сессий каждые 10 минут
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [token, session] of sessions.entries()) {
    if (session.expires < now) {
      sessions.delete(token);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    authLogger.debug(`Очищено устаревших сессий: ${cleaned}`);
  }
}, 10 * 60 * 1000);

/**
 * Аутентификация пользователя по имени и паролю
 */
export function authenticate(username: string, password: string): AuthResult {
  const users = config.getUsers();
  const user = users.find(u => u.user === username);
  
  if (!user) {
    authLogger.warn(`Попытка входа с несуществующим пользователем: ${username}`);
    return { success: false, error: 'Неверное имя пользователя или пароль' };
  }
  
  try {
    const passwordMatches = bcrypt.compareSync(password, user.password);
    if (!passwordMatches) {
      authLogger.warn(`Неверный пароль для пользователя: ${username}`);
      return { success: false, error: 'Неверное имя пользователя или пароль' };
    }
    
    authLogger.info(`Успешная аутентификация пользователя: ${username}`);
    return { success: true, user: username };
  } catch (err) {
    authLogger.error(`Ошибка проверки пароля для пользователя ${username}:`, (err as Error).message);
    return { success: false, error: 'Ошибка аутентификации' };
  }
}

/**
 * Создание новой сессии для пользователя
 */
export function createSession(username: string): SessionData {
  const token = generateToken();
  const expires = Date.now() + SESSION_TTL;
  
  const session: SessionData = {
    userId: username,
    token,
    expires
  };
  
  sessions.set(token, session);
  authLogger.debug(`Создана сессия для пользователя ${username}, токен: ${token.substring(0, 8)}...`);
  
  return session;
}

/**
 * Валидация токена сессии
 */
export function validateSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) {
    return false;
  }
  
  const now = Date.now();
  if (session.expires < now) {
    sessions.delete(token);
    return false;
  }
  
  // Обновляем время жизни сессии при каждом успешном запросе
  session.expires = now + SESSION_TTL;
  sessions.set(token, session);
  
  return true;
}

/**
 * Получение пользователя по токену сессии
 */
export function getSessionUser(token: string): string | null {
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    return null;
  }
  return session.userId;
}

/**
 * Удаление сессии (выход)
 */
export function logout(token: string): boolean {
  const existed = sessions.delete(token);
  if (existed) {
    authLogger.debug(`Сессия удалена, токен: ${token.substring(0, 8)}...`);
  }
  return existed;
}

/**
 * Генерация случайного токена
 */
function generateToken(): string {
  const randomPart = Math.random().toString(36).substring(2);
  const timePart = Date.now().toString(36);
  return `${randomPart}${timePart}`;
}

/**
 * Создание хэша пароля (для утилит генерации)
 */
export function hashPassword(password: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

/**
 * Проверка наличия пользователей в системе
 */
export function hasUsers(): boolean {
  const users = config.getUsers();
  authLogger.debug(`Проверка пользователей: загружено ${users.length}`);
  return users.length > 0;
}