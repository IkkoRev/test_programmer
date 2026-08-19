import { SearchParams, PaginationMeta, MentionRecord } from '../types/mention';
import { getDatabase } from '../database/connection';

/**
 * Mencari mention dengan fasilitas pencarian full-text (FTS), filter/saringan, dan paginasi.
 * 
 * Strategi Pencarian:
 *   - Jika parameter `q` diberikan: Gunakan engine SQLite FTS5 yang memiliki pemeringkatan (ranking) di title + content
 *   - Saringan lain (seperti filter sumber, periode rentang tanggal) akan mempersempit hasil melalui klausul WHERE
 *   - Urutan data dijamin stabil dan terdokumentasi dengan baik: default diurutkan menurun (DESC) menurut published_at
 * 
 * Mengapa menggunakan offset/limit alih-alih paginasi berbasis cursor?
 *   - Data umumnya ditarik (di-ingest) dalam bentuk batch, bukan real-time, jadi lompatan halaman sangat jarang terjadi
 *   - Paginasi Offset/Limit lebih simpel untuk dimengerti UI dasbor (nomor halaman, "menampilkan X dari Y")
 *   - Paginasi cursor akan lebih cocok jika ini adalah *infinite scroll* atau *feed* di perangkat mobile
 */
export async function search(params: SearchParams): Promise<{
  data: MentionRecord[];
  pagination: PaginationMeta;
}> {
  const db = getDatabase();

  const conditions: string[] = [];
  const queryParams: any[] = [];

  // Implementasi Full-text search melalui tabel FTS5
  if (params.q) {
    // FTS5 MATCH query — pencarian prefix difasilitasi dengan karakter bintang (*)
    const ftsQuery = params.q
      .trim()
      .split(/\s+/)
      .map(term => `"${term}"*`)
      .join(' ');

    conditions.push(`m.id IN (
      SELECT rowid FROM mentions_fts WHERE mentions_fts MATCH ?
    )`);
    queryParams.push(ftsQuery);
  }

  // Saringan berdasarkan sumber / source (pencocokan persis pada source yang sudah dinormalisasi)
  if (params.source) {
    conditions.push('m.source = ?');
    queryParams.push(params.source);
  }

  // Saringan rentang waktu perilisan berita
  if (params.from) {
    conditions.push('m.published_at >= ?');
    queryParams.push(params.from);
  }
  if (params.to) {
    // Agar batasan atas 'to' inklusif, kita perlu menambahkan ujung batas hari bila jam tak disebutkan
    conditions.push('m.published_at <= ?');
    queryParams.push(params.to.includes('T') ? params.to : `${params.to}T23:59:59Z`);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // Menghitung total data (untuk keperluan perhitungan paginasi)
  const countSql = `SELECT COUNT(*) as total FROM mentions m ${whereClause}`;
  const { total } = db.prepare(countSql).get(...queryParams) as { total: number };

  // Mengambil data halaman yang diminta
  // Pengurutan (Sort): stabilitas urutan dijamin dengan menyertakan id sebagai pengurut lapis kedua
  const validSorts = ['published_at', 'engagement'];
  const sortField = validSorts.includes(params.sort) ? params.sort : 'published_at';
  const orderDir = params.order === 'asc' ? 'ASC' : 'DESC';

  const dataSql = `
    SELECT 
      m.id, m.external_id, m.source, m.title, m.content, m.url,
      m.author, m.published_at, m.engagement, m.ingested_at, m.updated_at
    FROM mentions m
    ${whereClause}
    ORDER BY m.${sortField} ${orderDir}, m.id ASC
    LIMIT ? OFFSET ?
  `;

  const data = db.prepare(dataSql).all(
    ...queryParams,
    params.limit,
    params.offset
  ) as MentionRecord[];

  return {
    data,
    pagination: {
      total,
      limit: params.limit,
      offset: params.offset,
      has_more: params.offset + params.limit < total,
    },
  };
}
