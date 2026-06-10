import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT ?? 3306);
const DB_USER = process.env.DB_USER ?? 'root';
const DB_PASSWORD = process.env.DB_PASSWORD ?? '';
const DB_NAME = process.env.DB_NAME ?? 'sequencer';

async function main() {
  console.log(`[setup-db] Connecting to MySQL at ${DB_HOST}:${DB_PORT} as ${DB_USER}...`);

  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    multipleStatements: true,
  });

  // Create the database if it doesn't exist
  console.log(`[setup-db] Creating database '${DB_NAME}' if not exists...`);
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
  await conn.query(`USE \`${DB_NAME}\``);

  // Apply schema
  const schemaPath = path.resolve(__dirname, '../src/db/schema.sql');
  console.log(`[setup-db] Applying schema from ${schemaPath}...`);
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  await conn.query(schemaSql);
  console.log('[setup-db] Schema applied.');

  // Apply seed data
  const seedPath = path.resolve(__dirname, '../src/db/seed.sql');
  console.log(`[setup-db] Seeding data from ${seedPath}...`);
  const seedSql = fs.readFileSync(seedPath, 'utf-8');
  await conn.query(seedSql);
  console.log('[setup-db] Seed data loaded.');

  await conn.end();
  console.log('[setup-db] Done.');
}

main().catch((err) => {
  console.error('[setup-db] Fatal error:', err);
  process.exit(1);
});
