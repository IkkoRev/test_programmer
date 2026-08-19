import { setupTestDatabase, teardownTestDatabase } from './setup';
import { ingestMentions } from '../src/services/ingestService';
import { getDatabase } from '../src/database/connection';
import { RawMention } from '../src/types/mention';

describe('Ingest Service - Deduplication and Idempotency', () => {
  let db: any;

  beforeEach(() => {
    db = setupTestDatabase();
  });

  afterEach(() => {
    teardownTestDatabase();
  });

  it('inserts fresh records', async () => {
    const raw: RawMention[] = [
      {
        external_id: 'test-1',
        source: 'The Star',
        title: 'Test Title',
        content: 'Test content',
        engagement: 10
      }
    ];

    const result = await ingestMentions(raw);
    expect(result.inserted).toBe(1);
    
    const record = db.prepare('SELECT * FROM mentions WHERE external_id = ?').get('test-1');
    expect(record.engagement).toBe(10);
  });

  it('updates engagement on external_id collision (Layer 1 Deduplication)', async () => {
    const raw1: RawMention[] = [
      {
        external_id: 'test-1',
        source: 'The Star',
        content: 'Test content',
        engagement: 10
      }
    ];

    const raw2: RawMention[] = [
      {
        external_id: 'test-1',
        source: 'The Star',
        content: 'Test content',
        engagement: 50 // Higher engagement
      }
    ];

    await ingestMentions(raw1);
    const result = await ingestMentions(raw2);
    
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);

    const record = db.prepare('SELECT * FROM mentions WHERE external_id = ?').get('test-1');
    expect(record.engagement).toBe(50);
  });

  it('skips on cross-pipeline URL duplicate but updates engagement (Layer 2)', async () => {
    const raw1: RawMention[] = [
      {
        external_id: 'pipeline1-123',
        source: 'The Star',
        url: 'https://example.com/test',
        content: 'Test content',
        engagement: 10
      }
    ];

    const raw2: RawMention[] = [
      {
        external_id: 'pipeline2-456', // Different ID
        source: 'The Star',
        url: 'https://example.com/test', // Same URL
        content: 'Test content 2',
        engagement: 100
      }
    ];

    await ingestMentions(raw1);
    const result = await ingestMentions(raw2);
    
    expect(result.inserted).toBe(0);
    expect(result.skipped_duplicates).toBe(1);

    const record = db.prepare('SELECT * FROM mentions WHERE url = ?').get('https://example.com/test');
    expect(record.engagement).toBe(100);
    expect(record.external_id).toBe('pipeline1-123'); // Original ID remains
  });

  it('skips on same-source content duplicate but updates engagement (Layer 3)', async () => {
     const raw1: RawMention[] = [
      {
        external_id: 'cms-1',
        source: 'Malaysiakini',
        url: 'https://example.com/draft',
        content: 'Exact same content string',
        engagement: 10
      }
    ];

    const raw2: RawMention[] = [
      {
        external_id: 'cms-2',
        source: 'Malaysiakini',
        url: 'https://example.com/published', // Different URL
        content: 'Exact same content string', // Same content
        engagement: 20
      }
    ];

    await ingestMentions(raw1);
    const result = await ingestMentions(raw2);

    expect(result.inserted).toBe(0);
    expect(result.skipped_duplicates).toBe(1);

    const records = db.prepare('SELECT * FROM mentions').all();
    expect(records.length).toBe(1);
    expect(records[0].engagement).toBe(20);
  });
});
