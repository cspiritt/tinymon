export interface Service {
  id: string;
  name: string;
  type: 'ip' | 'http' | 'ssl';
  address: string;
  interval: number;
  timeout?: number;
  group?: string;
  warn_before?: number;      // For SSL: days before expiry to trigger warning
  check_at?: string;         // For SSL: check time (HH:MM)
}

export interface ServiceGroup {
  name: string;
  services: Service[];
  allOk: boolean;
  okCount: number;
  warningCount: number;
  errorCount: number;
}

export interface DatabaseConfig {
  type: 'sqlite' | 'postgres' | 'mysql';
  sqlite: {
    path: string;
  };
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  mysql: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
}

export interface Settings {
  bindAddress: string;
  port: number;
  checkInterval: number;
  timeout: number;
  retries: number;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  database: DatabaseConfig;
  notification_providers?: NotificationProviderConfig[];
  users?: User[];
}

export interface NotificationProviderConfig {
  id: string;
  type: 'telegram';
  parameters: Record<string, any>;
}

export type ServiceStatus = 'OK' | 'WARNING' | 'ERROR' | 'unknown';

export interface ServiceState {
  serviceId: string;
  serviceName: string;
  previousStatus: ServiceStatus;
  currentStatus: ServiceStatus;
  timestamp: number;
  failureCount: number;
  errorMessage?: string;
  ssl_days_until_expiry?: number;
}

export interface CheckResult {
  serviceId: string;
  serviceName: string;
  success: boolean;
  responseTime: number | null;
  errorMessage: string | null;
  failureCount: number;
  status: ServiceStatus;
  ssl_days_until_expiry?: number;  // For SSL: days until expiry
  ssl_expiry_date?: Date;          // For SSL: expiry date
}

export interface SSLCertificateInfo {
  valid_from: Date;
  valid_to: Date;
  issuer: string;
  subject: string;
  days_until_expiry: number;
}

export interface User {
  user: string;
  password: string; // bcrypt hash
}

export interface SessionData {
  userId: string;
  token: string;
  expires: number; // timestamp
}

export interface AuthResult {
  success: boolean;
  user?: string;
  error?: string;
}