import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

let db: Database.Database;

/**
 * Mendapatkan (atau membuat) singleton koneksi database.
 * 
 * Mengapa menggunakan better-sqlite3?
 * - API Synchronous — kode lebih sederhana, tidak ada callback hell, mudah dipahami
 * - Binding SQLite tercepat untuk Node.js (native C++ addon)
 * - Mode WAL memungkinkan pembacaan (read) bersamaan (concurrent) selama penulisan (write)
 * - Sangat cocok untuk proyek assessment: tanpa dependensi eksternal
 * 
 * Trade-off dibanding PostgreSQL (didokumentasikan di README):
 * - Tidak memiliki full-text search bawaan via tsvector → kita menggunakan SQLite FTS5 sebagai gantinya
 * - Tidak ada UPSERT dengan RETURNING pada versi SQLite lama → kita menggunakan INSERT OR REPLACE / ON CONFLICT
 * - Model single-writer → tidak masalah untuk use case ini (single API server)
 */
export function getDatabase(dbPath?: string): Database.Database {
  if (db) return db;

  const resolvedPath = dbPath || config.database.path;
  const dir = path.dirname(resolvedPath);

  // Pastikan direktori data sudah ada
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolvedPath);

  // Pragma untuk optimasi performa
  db.pragma('journal_mode = WAL');      // Write-Ahead Logging untuk concurrent reads
  db.pragma('foreign_keys = ON');       // Terapkan constraint Foreign Key
  db.pragma('busy_timeout = 5000');     // Tunggu maksimal 5 detik jika terjadi lock contention
  db.pragma('synchronous = NORMAL');    // Keseimbangan yang baik antara keamanan data dan kecepatan

  return db;
}

/**
 * Menutup koneksi database. Digunakan dalam testing untuk pembersihan (cleanup).
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = undefined as any;
  }
}

/**
 * Mendapatkan instance database baru yang bersih (fresh) untuk testing (in-memory).
 */
export function getTestDatabase(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  return testDb;
}
