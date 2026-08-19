# Media Monitoring Backend API

Backend service for ingesting, normalizing, searching, and analyzing media mentions. Built with Node.js, TypeScript, Express, and SQLite.

## 1. Cara Menjalankan Project

Project ini dirancang untuk **zero friction setup**. Tidak perlu menginstall database eksternal seperti PostgreSQL karena menggunakan SQLite.

**Prerequisites:**
- Node.js (v18+ recommended)
- npm

**Langkah-langkah:**

1. **Clone & Install Dependencies**
   ```
   git clone <repo-url>
   cd test-programmer
   npm install
   ```

2. **Jalankan Migrasi & Seeding Data**
   ```
   # Membuat skema database
   npm run migrate

   # Menjalankan pipeline ingest untuk file seed_mentions.json
   npm run seed
   ```

3. **Jalankan Server API**
   ```
   npm run dev
   # API akan berjalan di http://localhost:3000
   ```

4. **Jalankan Unit Tests**
   ```
   npm test
   ```

---

## 2. Skema Database & Alasannya

Skema dibuat secara eksplisit menggunakan SQL di `src/database/migrations/001_create_mentions.sql`.

**Desain Utama:**
- **Raw vs Normalized Data:** Saya memisahkan kolom raw (seperti `source_raw`, `content_raw`) dengan kolom bersih (`source`, `content`). Alasan utamanya adalah untuk menjaga *audit trail*. Jika kita menemukan bug di pipeline normalisasi nanti, kita bisa mem-parsing ulang data asli.
- **FTS5 Virtual Table (`mentions_fts`):** Alih-alih query `LIKE '%keyword%'` yang akan melakukan *sequential scan* O(n), saya menggunakan engine Full-Text Search SQLite (FTS5). Ini memberikan performa pencarian yang *scalable* O(log n) bahkan ketika data membesar.
- **Trigger Sync FTS:** Saya membuat trigger `AFTER INSERT/UPDATE/DELETE` agar *search index* FTS selalu tersinkronisasi otomatis tanpa perlu logic sinkronisasi rumit di level aplikasi (Application Layer).

---

## 3. Aturan Deduplikasi & Alasannya

Data ingestion rentan dengan duplikasi. Saya merancang **3-Layer Deduplication Strategy** yang mengutamakan pendekatan *conservative* (lebih baik lolos 1-2 false positives daripada menghapus mention yang bernilai):

*   **Layer 1: Exact ID Match (Pipeline Retries)**
    *   **Aturan:** UPSERT berdasarkan `external_id`.
    *   **Alasan:** Jika `external_id` sama persis, ini pasti *retry* dari pipeline ingestion. Kita akan memperbarui kolom `engagement` jika nilai barunya lebih tinggi (data yang ditarik lebih lambat dianggap memiliki statistik engagement yang lebih akurat).
*   **Layer 2: Cross-Pipeline Same URL**
    *   **Aturan:** Abaikan (Skip) jika `url` sudah ada (untuk mention dengan `url` non-null). Namun, lakukan update `engagement` pada data yang sudah ada secara *best-effort*.
    *   **Alasan:** Seringkali artikel yang sama terambil oleh pipeline data yang berbeda dan menghasilkan `external_id` yang berbeda, padahal URL-nya identik. URL adalah *canonical identifier* terbaik.
*   **Layer 3: CMS Duplicate Artifact (Content Fingerprint)**
    *   **Aturan:** Jika `source` (setelah normalisasi) sama DAN `content_hash` (SHA-256 dari konten yang sudah bersih dari HTML) sama, maka ini dianggap duplikat.
    *   **Alasan:** Dalam data *seed*, terdapat kasus (`mkn-1201` & `mkn-1202`) di mana penulis, konten, dan sumber identik, namun URL-nya berbeda (biasanya artefak dari CMS penerbit seperti draf vs publish). Layer 3 akan menangkap kasus ini. **Penting:** Layer ini hanya aktif jika sumbernya *sama*. Jika dua media berbeda meliput berita identik (`str-99502` The Star & `nst-40199` NST), ini bukan duplikat, melainkan *coverage breadth* yang justru dicari oleh analis PR.

---

## 4. Asumsi yang Diambil

1. **URL Null:** Beberapa postingan sosial media mungkin tidak memiliki URL kanonikal. Asumsinya: Data dengan `URL` bernilai `null` diperlakukan sebagai entri unik dan *hanya* akan dideduplikasi berdasarkan `external_id` (Layer 1) atau Hash Konten (Layer 3).
2. **Prioritas Engagement:** Pada saat terjadi konflik duplikasi (Layer 1, 2, atau 3), asumsi yang diambil adalah angka `engagement` tidak pernah berkurang, jadi kita selalu mengambil nilai *maksimum* (`MAX()`) dari record lama vs record baru.
3. **Pencarian Real-time vs Batch:** Mengingat ingestion dilakukan secara bulk/batch, `cursor-based pagination` dinilai berlebihan. Saya menggunakan `limit/offset` yang lebih familiar untuk dasbor PR.

---

## 5. Trade-off yang Disadari

*   **Trade-off 1: SQLite vs PostgreSQL**
    *   *Kenapa SQLite?* Untuk assessment, SQLite memungkinkan *zero setup* dari sisi reviewer. Sangat mudah diverifikasi.
    *   *Trade-off:* Jika kita menggunakan PostgreSQL, kita bisa memanfaatkan tipe data `tsvector` bawaan untuk *full-text search* (FTS) yang sedikit lebih robust daripada FTS5 SQLite, dan mendukung `INSERT ... ON CONFLICT RETURNING`. SQLite kurang ideal jika kita memiliki >10 *concurrent writer*, tapi cukup memadai untuk skenario single API Server ini.
*   **Trade-off 2: Manual Migration vs ORM (Prisma/TypeORM)**
    *   *Kenapa Manual SQL?* Sesuai brief untuk mendemonstrasikan kemampuan merancang database dan meminimalisir automagic.
    *   *Trade-off:* Memerlukan kode *runner* kustom dan kurang *type-safe* ketika melakukan query database jika skema berubah. Di produksi, kita akan memakai minimal Query Builder seperti Knex, atau Kysely untuk *type-safety* tanpa menyembunyikan SQL.
*   **Trade-off 3: Regex Sanitizer vs DOMPurify**
    *   *Kenapa Regex?* Untuk scope task ini, regex cukup untuk membersihkan payload HTML sederhana dan mencabut tag XSS (`<script>`).
    *   *Trade-off:* Dalam sistem produksi berskala besar, regex tidak cukup tangguh menghadapi vektor XSS modern. Kita harus menggunakan *DOM parser* lengkap seperti `sanitize-html` atau `DOMPurify`.

---
## 6. Waktu Pengerjaan

Total waktu pengerjaan sekitar 4-5 jam, dilakukan dalam 2 sesi kerja:
- Sesi 1 (~2-3 jam): analisis brief dan seed_mentions.json, desain schema database,
  implementasi endpoint bulk ingest beserta logika deduplikasi 3-layer.
- Sesi 2 (~2 jam): implementasi endpoint search dan stats, penulisan tes untuk logika
  deduplikasi & normalisasi, penulisan dan review README.

## 7. Dengan waktu satu minggu lagi, saya akan...

1. **Berpindah ke PostgreSQL + Kysely:** Memanfaatkan keunggulan GIN Index dan Partisi Tabel PostgreSQL jika jumlah *mention* diproyeksikan melebihi puluhan juta baris. Menggunakan Kysely untuk memastikan 100% Type-Safety dari query SQL.
2. **Message Queue untuk Ingest Endpoint:** Mengimplementasikan RabbitMQ atau BullMQ/Redis pada endpoint `/internal/mentions/bulk`. Pipeline injeksi sebaiknya *fire-and-forget*, sehingga API service hanya bertugas menaruh beban ke antrean (Queue) dan Background Worker akan perlahan memproses *normalization* serta penulisan ke DB.
3. **Materialized Views untuk Stats API:** Alih-alih melakukan `GROUP BY` secara *on-the-fly* terhadap tabel jutaan baris, saya akan membuat *cron job* untuk mengisi tabel *rollup* atau menggunakan *Materialized View* sehingga endpoint `/mentions/stats` bisa memuat dasbor dalam ukuran sub-milidetik (sub-ms).
4. **Library DOMPurify:** Mengganti *sanitizer* HTML saat ini yang berbasis Regex dengan library yang memang dibuat khusus untuk menangkal serangan DOM XSS, mengingat platform media monitoring banyak mengonsumsi data *User Generated Content* yang *untrusted*.
