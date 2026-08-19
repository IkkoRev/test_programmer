import { Router } from 'express';
import { bulkIngest } from '../controllers/mentionsController';
import { searchMentions } from '../controllers/mentionsController';
import { getMentionStats } from '../controllers/mentionsController';

const router = Router();

/**
 * POST /internal/mentions/bulk
 * Ingest massal (bulk) mention dari pipeline ingestion.
 * Idempotent — aman untuk diulang jika terjadi kegagalan (retry).
 */
router.post('/internal/mentions/bulk', bulkIngest);

/**
 * GET /mentions
 * Pencarian dan filter mention dengan paginasi.
 * Mendukung parameter: q, source, from, to, limit, offset, sort, order
 */
router.get('/mentions', searchMentions);

/**
 * GET /mentions/stats
 * Agregasi jumlah mention berdasarkan sumber atau hari.
 * Mendukung parameter: group_by (source | day), from, to, source
 */
router.get('/mentions/stats', getMentionStats);

export default router;
