-- Migrasi 001: Membuat tabel mentions
-- 
-- Keputusan desain:
--   1. source_raw + source: Menyimpan nilai asli untuk jejak audit (audit trail), nilai normalisasi untuk kueri (query).
--   2. content_raw + content: Pola yang sama — HTML asli dipertahankan, teks bersih digunakan untuk pencarian/tampilan.
--   3. content_hash: Sidik jari (fingerprint) SHA-256 dari konten bersih untuk deduplikasi sumber-yang-sama (Layer 3).
--   4. Index unik sebagian (Partial unique indexes): Mengizinkan nilai NULL di url dan content_hash tanpa melanggar keunikan (uniqueness).
--      SQLite menganggap setiap NULL sebagai sesuatu yang unik dalam constraint UNIQUE, yang mana adalah perilaku yang kita inginkan.
--   5. Tabel virtual FTS5: Engine full-text search dari SQLite, sebanding dengan tsvector pada PostgreSQL.
--      Kita menggunakan tabel FTS terpisah dengan sinkronisasi konten untuk performa pencarian.

CREATE TABLE IF NOT EXISTS mentions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id     TEXT NOT NULL UNIQUE,
    source_raw      TEXT NOT NULL,
    source          TEXT NOT NULL,
    title           TEXT,
    content_raw     TEXT,
    content         TEXT,
    url             TEXT,
    author          TEXT,
    published_at    TEXT,           -- Format string ISO 8601 UTC (SQLite tidak punya tipe bawaan TIMESTAMPTZ)
    engagement      INTEGER DEFAULT 0,
    content_hash    TEXT,           -- Hash SHA-256 dari konten bersih untuk deduplikasi Layer 3
    ingested_at     TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Deduplikasi Layer 2: Keunikan URL (hanya berlaku untuk URL yang tidak null)
-- Dalam SQLite, nilai NULL dianggap berbeda dalam indeks UNIQUE, sesuai dengan aturan standar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mentions_url 
    ON mentions(url) WHERE url IS NOT NULL;

-- Deduplikasi Layer 3: Sumber sama + konten sama → Duplikat dari CMS
CREATE UNIQUE INDEX IF NOT EXISTS uq_mentions_source_content 
    ON mentions(source, content_hash) WHERE content_hash IS NOT NULL;

-- Indeks untuk mengoptimalkan performa kueri
CREATE INDEX IF NOT EXISTS idx_mentions_source 
    ON mentions(source);
CREATE INDEX IF NOT EXISTS idx_mentions_published_at 
    ON mentions(published_at);
CREATE INDEX IF NOT EXISTS idx_mentions_source_published 
    ON mentions(source, published_at);

-- Tabel virtual FTS5 untuk pencarian full-text
-- Mengapa FTS5 ketimbang LIKE '%keyword%'?
--   - LIKE memindai setiap baris (scan) → O(n). FTS5 menggunakan indeks terbalik (inverted index) → O(log n).
--   - FTS5 mendukung pemeringkatan (ranking), pencarian awalan (prefix search), pencocokan frasa (phrase matching).
--   - Trade-off: membutuhkan ruang penyimpanan ekstra untuk indeks, dan konten harus disinkronisasi secara manual.
--   
-- content='' berarti "tanpa konten" (contentless) — kita hanya menyimpan teks di indeks FTS saja,
-- agar tidak menduplikasi ukuran data. Kita menggunakan content_rowid untuk terhubung kembali ke tabel mentions.
CREATE VIRTUAL TABLE IF NOT EXISTS mentions_fts USING fts5(
    title, 
    content,
    content='mentions',
    content_rowid='id'
);

-- Trigger untuk menjaga indeks FTS selalu sinkron dengan tabel mentions
CREATE TRIGGER IF NOT EXISTS mentions_ai AFTER INSERT ON mentions BEGIN
    INSERT INTO mentions_fts(rowid, title, content) 
    VALUES (new.id, COALESCE(new.title, ''), COALESCE(new.content, ''));
END;

CREATE TRIGGER IF NOT EXISTS mentions_ad AFTER DELETE ON mentions BEGIN
    INSERT INTO mentions_fts(mentions_fts, rowid, title, content) 
    VALUES ('delete', old.id, COALESCE(old.title, ''), COALESCE(old.content, ''));
END;

CREATE TRIGGER IF NOT EXISTS mentions_au AFTER UPDATE ON mentions BEGIN
    INSERT INTO mentions_fts(mentions_fts, rowid, title, content) 
    VALUES ('delete', old.id, COALESCE(old.title, ''), COALESCE(old.content, ''));
    INSERT INTO mentions_fts(rowid, title, content) 
    VALUES (new.id, COALESCE(new.title, ''), COALESCE(new.content, ''));
END;
