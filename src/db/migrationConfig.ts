import type { MigrationConfig } from 'drizzle-orm/migrator';

import { envOrThrow } from '../utils.js';
import { loadEnvFile } from 'node:process';

loadEnvFile();

type DBConfig = {
  db: {
    url: string;
    migrationConfig: MigrationConfig;
    platform: string;
  };
  fileserverHits: number;
};

const migrationConfig: MigrationConfig = {
  migrationsFolder: './src/db/migrations',
};

export const config: DBConfig = {
  db: {
    url: envOrThrow('DB_URL'),
    migrationConfig,
    platform: process.env.PLATFORM!,
  },
  fileserverHits: 0,
};
