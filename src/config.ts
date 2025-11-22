import { envOrThrow } from './utils';

import type { MigrationConfig } from 'drizzle-orm/migrator';

const { loadEnvFile } = require('node:process');
loadEnvFile();

type APIConfig = {
  fileserverHits: number;
  dbURL: string;
};

type DBConfig = {
  db: {
    url: string;
    migrationConfig: MigrationConfig;
    platform: string;
  };
  fileserverHits: number;
};

const migrationConfig: MigrationConfig = {
  migrationsFolder: 'src/db/migrations',
};

export const config: DBConfig = {
  db: {
    url: envOrThrow('DB_URL'),
    migrationConfig,
    platform: process.env.PLATFORM!,
  },
  fileserverHits: 0,
};
