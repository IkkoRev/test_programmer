import crypto from 'crypto';
import { RawMention, NormalizedMention } from '../types/mention';

/**
 * Peta kamus normalisasi sumber (source).
 * 
 * Insight Utama: Kita menormalisasi menjadi penamaan baku (canonical) dengan cara
 * mencocokkan nilai asal yang diubah menjadi huruf kecil (lowercase) dan dipotong spasinya (trim).
 * Hal ini dapat menangani:
 *   - Variasi huruf kapital: "TWITTER" → "Twitter"
 *   - Spasi berlebih di belakang: "malaysiakini " → "Malaysiakini"  
 *   - Penamaan bercorak nama domain: "thestar" → "The Star"
 * 
 * Pada implementasi produksi, mapping ini biasanya diletakkan dalam database atau
 * file konfigurasi khusus yang diatur oleh divisi operasi (ops). Untuk penilaian ini, pemetaan
 * konstan secara statik sudah sangat mencukupi.
 */
const SOURCE_MAP: Record<string, string> = {
  'the star': 'The Star',
  'thestar': 'The Star',
  'thestar.com.my': 'The Star',
  'new straits times': 'New Straits Times',
  'nst': 'New Straits Times',
  'twitter': 'Twitter',
  'facebook': 'Facebook',
  'instagram': 'Instagram',
  'malaysiakini': 'Malaysiakini',
};

/**
 * Menormalisasi penamaan sumber ke dalam format standarnya (canonical form).
 */
export function normalizeSource(raw: string): string {
  const cleaned = raw.trim().toLowerCase();
  return SOURCE_MAP[cleaned] || raw.trim(); // Fallback: kembalikan hasil trim teks aslinya
}

/**
 * Parsing aneka rupa bentuk tanggal rilis dan mengubahnya menjadi bentuk string ISO 8601 UTC.
 * 
 * Fungsi ini mampu menangani seluk-beluk variasi bentuk format yang sering tersaji di seed_mentions.json:
 *   1. Format ISO 8601 UTC:        "2026-08-10T08:15:00Z"
 *   2. ISO 8601 disertai timezone: "2026-08-11T14:02:33+08:00"
 *   3. Spasi sbg pemisah (space):  "2026-08-10 08:20:00"
 *   4. Format waktu stempel Unix:  1786435200
 *   5. Pemisahan DD/MM/YYYY:       "11/08/2026"
 *   6. null / kosong / empty:      → null
 */
export function parsePublishedAt(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // Waktu stempel Unix (dalam number)
  if (typeof value === 'number') {
    // Menangani masukan format detik maupun milidetik
    const ts = value > 1e12 ? value : value * 1000;
    return new Date(ts).toISOString();
  }

  const str = String(value).trim();
  if (!str) return null;

  // Format bentuk DD/MM/YYYY
  const ddmmyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // Coba memilah via cara parser standar konstruktor JS Date
  // (Otomatis dapat memproses format ISO 8601, offset lokasi waktu, dsb.)
  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }

  // Jika semua jalur parse gagal dilalui, maka kembalikan null
  // Ketimbang memaksakan pengembalian nilai abal-abal yang akan mencemari/korupsi basis data
  console.warn(`⚠️  Tidak bisa mem-parse (mengurai) format tanggal: "${value}"`);
  return null;
}

/**
 * Mencukur sintaks dan mengurai nilai entitas HTML dari untaian string mentah.
 * 
 * Keamanan: Proses ini bakal menghanguskan injeksi payload sintaks <script>
 * dan aneka wujud sisipan HTML lain yang berpotensi mencederai sistem.
 * Dari data seed telah kami amati eksistensi suatu script sisipan mematikan: <script>alert(1)</script>
 * 
 * Lantas, mengapa tidak pakai alat saring spesialis macam "sanitize-html"?
 * Jawabnya, untuk cakupan ranah penugasan ini, pencabutan secara Regex dirasa cukup.
 * Pada realitas skala proyek sesungguhnya dan berhadapan langsung dengan muatan bebas publik (User-generated Content),
 * sebuah pelucut XSS tuntas macam `DOMPurify` adalah kebutuhan wajib.
 */
export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;

  let text = html
    // Singkirkan elemen naskah tag script sepenuhnya (upaya preventif meredam aksi injeksi XSS)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Usir blok gaya riasan (style tags) beserta kandungannya
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Cabut habis-habisan sisipan serbaneka tag HTML yang masih ada tersisa
    .replace(/<[^>]+>/g, '')
    // Konversikan (Decode) representasi entitas elemen HTML lazim yang melekat
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    // Jadikan ragam kemunculan karakter jarak/spasi rangkap untuk diciutkan sekadar jadi 1 ketukan beruntun spasi
    .replace(/\s+/g, ' ')
    .trim();

  return text || null;
}

/**
 * Mengubah dan mengekstrak nominal bobot engagement yang berwujud dalam rupa beragam format.
 * Berdaya melahap dan memproses: jenis Number, "1,204" (pemberian koma pada teks tipe string), hingga nilai null
 */
export function parseEngagement(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Math.max(0, Math.round(value));

  // Menanggalkan/Mencabut penulisan simbol pemisah koma lalu mem-parse nilainya
  const cleaned = String(value).replace(/,/g, '').trim();
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? 0 : Math.max(0, parsed);
}

/**
 * Mencetak untaian kode sidik jari berenkripsi (Hash) berjenis SHA-256 mengacu dari rahim isi berita (content)
 * Hal ini memegang kedudukan sangat krusial dalam menyokong proses penyaringan duplikasi muatan Layer ke-3
 * Bilamana porsi teks isi konten berupa data bernilai kosong (empty/null) → memulangkan status null.
 */
export function generateContentHash(content: string | null): string | null {
  if (!content) return null;
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Pintu masuk muara tahapan Normalisasi Data.
 * Akan menangkap masukan mention mentahan liar kemudian mendaurnya agar bermetamorfosa menjadi
 * tatanan rekaman data rapi sesuai tabiat pakem dan bersih tatkala ditampung basis data.
 */
export function normalizeMention(raw: RawMention): NormalizedMention {
  const content = stripHtml(raw.content);

  return {
    external_id: raw.external_id,
    source_raw: raw.source,
    source: normalizeSource(raw.source),
    title: raw.title?.trim() || null,
    content_raw: raw.content || null,
    content,
    url: raw.url?.trim() || null,
    author: raw.author?.trim() || null,
    published_at: parsePublishedAt(raw.published_at),
    engagement: parseEngagement(raw.engagement),
    content_hash: generateContentHash(content),
  };
}
