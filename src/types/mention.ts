/**
 * Data mention mentah seperti yang diterima dari pipeline ingestion.
 * Field sengaja dibiarkan longgar — datanya kotor dan perlu dinormalisasi.
 */
export interface RawMention {
  external_id: string;
  source: string;
  title?: string | null;
  content?: string | null;
  url?: string | null;
  author?: string | null;
  published_at?: string | number | null;
  engagement?: number | string | null;
}

/**
 * Mention yang sudah dinormalisasi dan siap dimasukkan ke database.
 * Semua field sudah dibersihkan, memiliki tipe data yang benar, dan divalidasi.
 */
export interface NormalizedMention {
  external_id: string;
  source_raw: string;
  source: string;
  title: string | null;
  content_raw: string | null;
  content: string | null;
  url: string | null;
  author: string | null;
  published_at: string | null; // Format string ISO 8601 UTC
  engagement: number;
  content_hash: string | null;
}

/**
 * Representasi mention seperti yang disimpan di dalam database.
 */
export interface MentionRecord extends NormalizedMention {
  id: number;
  ingested_at: string;
  updated_at: string;
}

/**
 * Bentuk parameter untuk endpoint pencarian (search).
 */
export interface SearchParams {
  q?: string;
  source?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
  sort: 'published_at' | 'engagement';
  order: 'asc' | 'desc';
}

/**
 * Metadata paginasi yang dikembalikan bersama hasil pencarian.
 */
export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/**
 * Ringkasan hasil dari proses bulk ingest.
 */
export interface IngestResult {
  inserted: number;
  updated: number;
  skipped_duplicates: number;
  errors: Array<{ external_id: string; error: string }>;
}

/**
 * Item respons untuk endpoint statistik.
 */
export interface StatItem {
  group: string;
  count: number;
}
