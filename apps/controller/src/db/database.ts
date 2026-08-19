import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrations } from './migrate.js';

export interface DatabaseContext {
  db: DatabaseSync;
  close: () => void;
}

export function initDatabase(dbPath: string): DatabaseContext {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);

  // Enable WAL and foreign keys
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  runMigrations(db);

  return {
    db,
    close: () => {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
  };
}
