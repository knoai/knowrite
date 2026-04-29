import { Options } from 'sequelize';
import path from 'path';

export interface DatabaseConfig {
  dialect: 'sqlite' | 'postgres';
  sequelizeOptions: Options;
}

function getSqliteConfig(): Options {
  const storage = process.env.DB_STORAGE || path.join(__dirname, '../../data/novel.db');
  return {
    dialect: 'sqlite',
    storage,
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '5', 10),
      min: parseInt(process.env.DB_POOL_MIN || '0', 10),
      acquire: 30000,
      idle: 10000,
    },
  };
}

function getPostgresConfig(): Options {
  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '5432', 10);
  const database = process.env.DB_NAME || 'knowrite';
  const username = process.env.DB_USER || 'knowrite';
  const password = process.env.DB_PASSWORD || '';

  return {
    dialect: 'postgres',
    host,
    port,
    database,
    username,
    password,
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      min: parseInt(process.env.DB_POOL_MIN || '0', 10),
      acquire: 30000,
      idle: 10000,
    },
  };
}

export function getDatabaseConfig(): DatabaseConfig {
  const dialect = (process.env.DB_DIALECT || 'sqlite') as 'sqlite' | 'postgres';

  if (dialect === 'postgres') {
    return {
      dialect: 'postgres',
      sequelizeOptions: getPostgresConfig(),
    };
  }

  return {
    dialect: 'sqlite',
    sequelizeOptions: getSqliteConfig(),
  };
}

export function getSyncOptions(): { force?: boolean; alter?: boolean } {
  const force = process.env.DB_SYNC_FORCE === 'true';
  const alter = process.env.DB_SYNC_ALTER === 'true';
  if (force) return { force: true };
  if (alter) return { alter: true };
  return {};
}
