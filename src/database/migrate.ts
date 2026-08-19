import fs from 'fs';
import path from 'path';
import { getDatabase } from './connection';

/**
 * Menjalankan semua file migrasi SQL secara berurutan.
 * 
 * Sistem migrasi sederhana berbasis file:
 * - Membaca file berekstensi .sql dari folder migrations/, diurutkan berdasarkan nama file
 * - Melacak file migrasi yang sudah dijalankan dalam tabel _migrations
 * - Setiap migrasi dijalankan di dalam sebuah transaksi (transaction) demi keamanan data (atomicity)
 * 
 * Mengapa tidak menggunakan library migrasi (seperti knex/prisma migrate)?
 * - Brief assessment secara eksplisit meminta agar query SQL ditulis manual, bukan "auto-magic"
 * - Pendekatan ini memberikan kendali dan visibilitas penuh atas pembuatan skema
 * - Cukup sederhana dan memadai untuk cakupan tugas ini — sistem skala produksi biasanya akan menggunakan tool yang lebih mapan
 */
export function runMigrations(db?: ReturnType<typeof getDatabase>): void {
  const database = db || getDatabase();

  // Membuat tabel pelacakan migrasi
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Membaca daftar file migrasi
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // Urutan alfabetis = urutan kronologis berdasarkan awalan angka pada file

  const applied = database
    .prepare('SELECT filename FROM _migrations')
    .all()
    .map((row: any) => row.filename);

  for (const file of files) {
    if (applied.includes(file)) {
      console.log(`  ⏭  Melewati ${file} (sudah diterapkan sebelumnya)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    const migrate = database.transaction(() => {
      // Mengeksekusi script SQL migrasi (bisa memuat banyak pernyataan/statement)
      database.exec(sql);

      // Mencatat riwayat migrasi yang sukses
      database.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file);
    });

    migrate();
    console.log(`  ✅ Menerapkan ${file}`);
  }
}

// Untuk dijalankan langsung: npx tsx src/database/migrate.ts
if (require.main === module) {
  console.log('\n📦 Menjalankan migrasi database...\n');
  runMigrations();
  console.log('\n✅ Semua migrasi berhasil diterapkan.\n');
}
