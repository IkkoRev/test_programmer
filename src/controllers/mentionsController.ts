import { Request, Response } from 'express';
import { RawMention } from '../types/mention';
import { ingestMentions } from '../services/ingestService';
import { search } from '../services/searchService';
import { getStats } from '../services/statsService';
import { config } from '../config';

/**
 * POST /internal/mentions/bulk
 * Menerima array mention mentah, menormalisasi, dan menyimpannya (upsert).
 */
export async function bulkIngest(req: Request, res: Response): Promise<void> {
  try {
    // Menerima baik format { mentions: [...] } maupun sekadar array [...]
    const rawMentions: RawMention[] = Array.isArray(req.body)
      ? req.body
      : req.body.mentions;

    if (!Array.isArray(rawMentions) || rawMentions.length === 0) {
      res.status(400).json({
        error: 'Invalid request body',
        message: 'Diharapkan sebuah array of mentions atau { "mentions": [...] }',
      });
      return;
    }

    const result = await ingestMentions(rawMentions);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Bulk ingest error:', error);
    res.status(500).json({
      error: 'Ingest failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * GET /mentions
 * Pencarian full-text (full-text search) dengan filter dan paginasi.
 */
export async function searchMentions(req: Request, res: Response): Promise<void> {
  try {
    const params = {
      q: req.query.q as string | undefined,
      source: req.query.source as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      limit: Math.min(
        parseInt(req.query.limit as string) || config.pagination.defaultLimit,
        config.pagination.maxLimit
      ),
      offset: Math.max(parseInt(req.query.offset as string) || 0, 0),
      sort: (['published_at', 'engagement'].includes(req.query.sort as string)
        ? req.query.sort
        : 'published_at') as 'published_at' | 'engagement',
      order: (['asc', 'desc'].includes(req.query.order as string)
        ? req.query.order
        : 'desc') as 'asc' | 'desc',
    };

    const result = await search(params);

    res.status(200).json(result);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      error: 'Search failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * GET /mentions/stats
 * Agregasi jumlah (count) berdasarkan sumber atau hari.
 */
export async function getMentionStats(req: Request, res: Response): Promise<void> {
  try {
    const groupBy = req.query.group_by as string;

    if (!groupBy || !['source', 'day'].includes(groupBy)) {
      res.status(400).json({
        error: 'Invalid group_by parameter',
        message: 'Nilai yang didukung: "source", "day"',
      });
      return;
    }

    const filters = {
      source: req.query.source as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    };

    const data = await getStats(groupBy as 'source' | 'day', filters);

    res.status(200).json({ data });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      error: 'Stats query failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
