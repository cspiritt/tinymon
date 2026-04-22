/**
 * Authentication and session management module
 */

import bcrypt from 'bcryptjs';
import { AuthResult, SessionData, User } from '../types';
import config from './config';
import Logger from './logger';

const authLogger = Logger.withPrefix('Auth');

// Active sessions storage: token -> SessionData
const sessions = new Map<string, SessionData>();

// Session lifetime in milliseconds (24 hours)
const SESSION_TTL = 24 * 60 * 60 * 1000;

// Cleanup of expired sessions every 10 minutes
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
    authLogger.debug(`Cleaned up expired sessions: ${cleaned}`);
  }
}, 10 * 60 * 1000);

/**
 * User authentication by username and password
 */
export function authenticate(username: string, password: string): AuthResult {
  const users = config.getUsers();
  const user = users.find(u => u.user === username);
  
  if (!user) {
    authLogger.warn(`Login attempt with non-existent user: ${username}`);
    return { success: false, error: 'Invalid username or password' };
  }
  
  try {
    const passwordMatches = bcrypt.compareSync(password, user.password);
    if (!passwordMatches) {
      authLogger.warn(`Incorrect password for user: ${username}`);
      return { success: false, error: 'Invalid username or password' };
    }
    
    authLogger.info(`Successful user authentication: ${username}`);
    return { success: true, user: username };
  } catch (err) {
    authLogger.error(`Password verification error for user ${username}:`, (err as Error).message);
    return { success: false, error: 'Authentication error' };
  }
}

/**
 * Creating a new session for user
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
  authLogger.debug(`Session created for user ${username}, token: ${token.substring(0, 8)}...`);
  
  return session;
}

/**
 * Session token validation
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
  
  // Update session lifetime on each successful request
  session.expires = now + SESSION_TTL;
  sessions.set(token, session);
  
  return true;
}

/**
 * Get user by session token
 */
export function getSessionUser(token: string): string | null {
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    return null;
  }
  return session.userId;
}

/**
 * Session deletion (logout)
 */
export function logout(token: string): boolean {
  const existed = sessions.delete(token);
  if (existed) {
    authLogger.debug(`Session deleted, token: ${token.substring(0, 8)}...`);
  }
  return existed;
}

/**
 * Random token generation
 */
function generateToken(): string {
  const randomPart = Math.random().toString(36).substring(2);
  const timePart = Date.now().toString(36);
  return `${randomPart}${timePart}`;
}

/**
 * Password hash creation (for generation utilities)
 */
export function hashPassword(password: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

/**
 * Check if users exist in the system
 */
export function hasUsers(): boolean {
  const users = config.getUsers();
  authLogger.debug(`User check: loaded ${users.length}`);
  return users.length > 0;
}