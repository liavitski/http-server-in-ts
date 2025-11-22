import {
  PgTable,
  timestamp,
  varchar,
  uuid,
  pgTable,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_ad')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  email: varchar('email', { length: 256 }).unique().notNull(),
});

export type NewUser = typeof users.$inferInsert;
