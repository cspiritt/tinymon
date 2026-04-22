import config from '../utils/config';
import { SQLiteAdapter } from './adapters/sqlite-adapter';
import { PostgresAdapter } from './adapters/postgres-adapter';
import { MySQLAdapter } from './adapters/mysql-adapter';
import { DatabaseAdapter } from './database-adapter';

type DatabaseType = 'sqlite' | 'postgres' | 'mysql';

const adapterClasses: Record<DatabaseType, new (config: any) => DatabaseAdapter> = {
  sqlite: SQLiteAdapter,
  postgres: PostgresAdapter,
  mysql: MySQLAdapter
};

class DatabaseFactory {
  static async createAdapter(): Promise<DatabaseAdapter> {
    const dbConfig = config.getSettings().database;
    const dbType: DatabaseType = dbConfig.type || 'sqlite';

    const AdapterClass = adapterClasses[dbType];
    if (!AdapterClass) {
      throw new Error(`Unsupported database type: ${dbType}`);
    }

    // Get configuration for specific database type
    const typeConfig = dbConfig[dbType] || {};
    const adapter = new AdapterClass(typeConfig);

    await adapter.connect();
    return adapter;
  }
}

export default DatabaseFactory;