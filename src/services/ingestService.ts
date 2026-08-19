import { RawMention, NormalizedMention, IngestResult } from '../types/mention';
import { getDatabase } from '../database/connection';
import { normalizeMention } from '../utils/normalizer';

/**
 * Melakukan bulk ingest (pemasukan data masal) untuk array mention mentah: normalisasi → deduplikasi → upsert.
 * 
 * Idempotency (keamanan pengulangan proses) dijamin melalui tiga lapisan constraint database:
 *   Layer 1: UNIQUE(external_id) — menangkap duplikat dari pipeline ingestion yang sama (retries)
 *   Layer 2: UNIQUE(url) WHERE url IS NOT NULL — menangkap artikel yang sama namun masuk via pipeline berbeda
 *   Layer 3: UNIQUE(source, content_hash) WHERE content_hash IS NOT NULL — menangkap duplikat dari CMS
 * 
 * Saat terjadi konflik (ON CONFLICT), kita akan UPDATE nilai engagement dengan nilai yang lebih tinggi
 * (mengasumsikan data yang lebih baru ditarik adalah yang paling mutakhir) lalu memperbarui tanggal updated_at.
 */
export async function ingestMentions(rawMentions: RawMention[]): Promise<IngestResult> {
  const db = getDatabase();
  const result: IngestResult = {
    inserted: 0,
    updated: 0,
    skipped_duplicates: 0,
    errors: [],
  };

  // Menyiapkan statement operasi UPSERT
  // ON CONFLICT untuk external_id: akan memperbarui kolom engagement jika nilai barunya lebih tinggi
  const upsertStmt = db.prepare(`
    INSERT INTO mentions (
      external_id, source_raw, source, title, content_raw, content, 
      url, author, published_at, engagement, content_hash
    ) VALUES (
      @external_id, @source_raw, @source, @title, @content_raw, @content,
      @url, @author, @published_at, @engagement, @content_hash
    )
    ON CONFLICT(external_id) DO UPDATE SET
      engagement = MAX(mentions.engagement, excluded.engagement),
      title = COALESCE(excluded.title, mentions.title),
      content = COALESCE(excluded.content, mentions.content),
      content_raw = COALESCE(excluded.content_raw, mentions.content_raw),
      author = COALESCE(excluded.author, mentions.author),
      published_at = COALESCE(excluded.published_at, mentions.published_at),
      updated_at = datetime('now')
  `);

  // Seluruh proses data mention dijalankan di dalam satu transaksi agar terjamin atomicity-nya (aman)
  const processAll = db.transaction(() => {
    for (const raw of rawMentions) {
      try {
        // Normalisasi data kotor
        const normalized = normalizeMention(raw);

        // Memeriksa keberadaan data sebelum dieksekusi UPSERT agar kita tahu
        // ini operasi insert baru atau update secara akurat
        const existing = db.prepare('SELECT 1 FROM mentions WHERE external_id = ?').get(normalized.external_id);

        // Menjalankan upaya upsert ke dalam tabel
        const info = upsertStmt.run(normalized);

        if (info.changes > 0) {
          if (existing) {
            result.updated++;
          } else {
            result.inserted++;
          }
        }
      } catch (error: any) {
        // Menangani konflik/error berupa duplikasi URL atau content_hash (Deduplikasi Layer 2 & 3)
        if (error.message?.includes('UNIQUE constraint failed')) {
          result.skipped_duplicates++;

          // Jika konflik URL, cobalah perbarui engagement pada record lama yang ada
          if (error.message.includes('uq_mentions_url') || error.message.includes('mentions.url')) {
            try {
              const normalized = normalizeMention(raw);
              db.prepare(`
                UPDATE mentions 
                SET engagement = MAX(engagement, ?),
                    updated_at = datetime('now')
                WHERE url = ?
              `).run(normalized.engagement, normalized.url);
            } catch (_) { /* Update ini bersifat best-effort, abaikan jika gagal */ }
          }

          // Jika konflik content hash (sumber sama + isi konten sama)
          if (error.message.includes('uq_mentions_source_content') || error.message.includes('mentions.source, mentions.content_hash')) {
            try {
              const normalized = normalizeMention(raw);
              db.prepare(`
                UPDATE mentions 
                SET engagement = MAX(engagement, ?),
                    published_at = COALESCE(published_at, ?),
                    updated_at = datetime('now')
                WHERE source = ? AND content_hash = ?
              `).run(
                normalized.engagement, 
                normalized.published_at,
                normalized.source, 
                normalized.content_hash
              );
            } catch (e) { console.error('Gagal memperbarui record pada deduplikasi Layer 3', e); }
          }
        } else {
          // Tangkap error-error lain di luar constraint database
          result.errors.push({
            external_id: raw.external_id || 'unknown',
            error: error.message || 'Error yang tidak diketahui',
          });
        }
      }
    }
  });

  processAll();

  return result;
}
