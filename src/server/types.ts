export interface Service {
  id: string;
  name: string;
  type: 'ip' | 'http';
  address: string;
  interval: number;
  timeout?: number;
  group?: string;
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
}

export interface CheckResult {
  serviceId: string;
  serviceName: string;
  success: boolean;
  responseTime: number | null;
  errorMessage: string | null;
  failureCount: number;
  status: 'OK' | 'WARNING' | 'ERROR' | 'unknown';
}