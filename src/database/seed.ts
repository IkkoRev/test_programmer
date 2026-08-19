import fs from 'fs';
import path from 'path';
import { getDatabase } from './connection';
import { runMigrations } from './migrate';
import { ingestMentions } from '../services/ingestService';

/**
 * Mengisi database (seeding) menggunakan data dari file seed_mentions.json.
 * Script ini melakukan langkah-langkah berikut:
 *   1. Menjalankan migrasi database agar skema dipastikan sudah ada
 *   2. Membaca isi file seed_mentions.json
 *   3. Memasukkan (ingest) data tersebut melewati pipeline reguler (lengkap dengan proses normalisasi + deduplikasi)
 * 
 * Sangat aman untuk dijalankan berulang kali — dirancang agar idempotent.
 */
async function seed(): Promise<void> {
  console.log('\n🌱 Melakukan proses seeding database...\n');

  // Pastikan skema migrasi sudah diterapkan
  runMigrations();

  // Membaca data mentah dari file
  const seedPath = path.join(__dirname, '..', '..', 'seed_mentions.json');
  
  if (!fs.existsSync(seedPath)) {
    console.error(`❌ File seed tidak ditemukan pada jalur: ${seedPath}`);
    process.exit(1);
  }

  const rawData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  console.log(`📄 Membaca ${rawData.length} data mention mentah dari file seed\n`);

  // Proses data melewati pipeline reguler
  const result = await ingestMentions(rawData);

  console.log('📊 Hasil dari proses Ingest:');
  console.log(`   ✅ Data Baru Disisipkan: ${result.inserted}`);
  console.log(`   🔄 Data Diperbarui:      ${result.updated}`);
  console.log(`   ⏭  Data Dilewati (Duplikat): ${result.skipped_duplicates}`);
  if (result.errors.length > 0) {
    console.log(`   ❌ Terjadi Error: ${result.errors.length}`);
    result.errors.forEach(e => console.log(`      - ${e.external_id}: ${e.error}`));
  }

  // Tampilkan total keseluruhan baris data di database
  const db = getDatabase();
  const { count } = db.prepare('SELECT COUNT(*) as count FROM mentions').get() as { count: number };
  console.log(`\n💾 Total mention yang tersimpan di dalam database: ${count}\n`);
}

seed().catch(err => {
  console.error('Proses seed gagal:', err);
  process.exit(1);
});
