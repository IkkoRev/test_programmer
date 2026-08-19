import { StatItem } from '../types/mention';
import { getDatabase } from '../database/connection';

/**
 * Mendapatkan ringkasan jumlah (agregasi) mention yang dikelompokkan menurut hari atau sumber berita.
 * Digunakan sebagai penyuplai data untuk grafik/charts pada dasbor.
 * 
 * Catatan Desain: Ini adalah sekadar kueri dasar GROUP BY — tidak diperlukan caching
 * jika volume data masih relatif kecil. Untuk tahap produksi (skala jutaan data),
 * pertimbangkan pemakaian "materialized views" atau tabel penampung (rollup tables) tersendiri.
 */
export async function getStats(
  groupBy: 'source' | 'day',
  filters?: { source?: string; from?: string; to?: string }
): Promise<StatItem[]> {
  const db = getDatabase();

  const conditions: string[] = [];
  const params: any[] = [];

  // Implementasi saringan opsional bila diberikan
  if (filters?.source) {
    conditions.push('source = ?');
    params.push(filters.source);
  }
  if (filters?.from) {
    conditions.push('published_at >= ?');
    params.push(filters.from);
  }
  if (filters?.to) {
    conditions.push('published_at <= ?');
    params.push(filters.to.includes('T') ? filters.to : `${filters.to}T23:59:59Z`);
  }

  let sql: string;

  // Jika mengelompokkan menurut hari, tanggal nilainya tidak boleh NULL
  if (groupBy === 'day') {
    conditions.push('published_at IS NOT NULL');
  }

  // Menyusun kembali klausul WHERE jika saringan/kondisi diberikan
  const finalWhereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  if (groupBy === 'source') {
    sql = `
      SELECT source AS "group", COUNT(*) AS count
      FROM mentions
      ${finalWhereClause}
      GROUP BY source
      ORDER BY count DESC
    `;
  } else {
    // Pengelompokan menurut hari — ekstrak bagian tanggal dari string ISO 8601 published_at
    // Fungsi SQLite date() ini mengekstrak format YYYY-MM-DD dari string waktu/tanggal
    sql = `
      SELECT date(published_at) AS "group", COUNT(*) AS count
      FROM mentions
      ${finalWhereClause}
      GROUP BY date(published_at)
      ORDER BY "group" ASC
    `;
  }

  const rows = db.prepare(sql).all(...params) as StatItem[];

  return rows;
}
