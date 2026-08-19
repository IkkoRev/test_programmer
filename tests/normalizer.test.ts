import {
  normalizeSource,
  parsePublishedAt,
  stripHtml,
  parseEngagement,
  normalizeMention
} from '../src/utils/normalizer';

describe('Normalizer Utils', () => {
  describe('normalizeSource', () => {
    it('normalizes known sources to canonical names', () => {
      expect(normalizeSource('thestar')).toBe('The Star');
      expect(normalizeSource('the star')).toBe('The Star');
      expect(normalizeSource('malaysiakini ')).toBe('Malaysiakini');
      expect(normalizeSource('TWITTER')).toBe('Twitter');
    });

    it('falls back to trimmed string for unknown sources', () => {
      expect(normalizeSource(' Unknown Blog ')).toBe('Unknown Blog');
    });
  });

  describe('parsePublishedAt', () => {
    it('parses ISO 8601 UTC', () => {
      expect(parsePublishedAt('2026-08-10T08:15:00Z')).toBe('2026-08-10T08:15:00.000Z');
    });

    it('parses Unix timestamps (seconds)', () => {
      expect(parsePublishedAt(1786435200)).toBe('2026-08-11T08:00:00.000Z');
    });

    it('parses DD/MM/YYYY format', () => {
      expect(parsePublishedAt('11/08/2026')).toBe('2026-08-11T00:00:00.000Z');
    });

    it('returns null for empty/invalid values', () => {
      expect(parsePublishedAt(null)).toBeNull();
      expect(parsePublishedAt('')).toBeNull();
      expect(parsePublishedAt('not-a-date')).toBeNull();
    });
  });

  describe('stripHtml', () => {
    it('removes tags and decodes entities', () => {
      expect(stripHtml('<p>Hello&nbsp;World&amp;Everyone</p>')).toBe('Hello World&Everyone');
    });

    it('removes <script> tags for XSS protection', () => {
      expect(stripHtml('<p>Safe</p><script>alert(1)</script>')).toBe('Safe');
    });

    it('returns null for empty content', () => {
      expect(stripHtml('')).toBeNull();
      expect(stripHtml(null)).toBeNull();
    });
  });

  describe('parseEngagement', () => {
    it('parses strings with commas', () => {
      expect(parseEngagement('1,204')).toBe(1204);
    });

    it('handles numeric input', () => {
      expect(parseEngagement(412)).toBe(412);
      expect(parseEngagement(412.5)).toBe(413);
    });

    it('returns 0 for invalid or negative input', () => {
      expect(parseEngagement(-10)).toBe(0);
      expect(parseEngagement('abc')).toBe(0);
      expect(parseEngagement(null)).toBe(0);
    });
  });
});
