import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Tests for the dictionary parsing logic.
 * We test the build-dict parser functions directly rather than IndexedDB
 * (which requires a browser environment).
 */

// Inline the parseLine logic from build-dict for testing
import { pinyinToToneMarks } from '../../src/common/pinyin';

interface RawEntry {
  t: string;
  s: string;
  p: string;
  r: string;
  d: string[];
}

function parseLine(line: string): RawEntry | null {
  if (line.startsWith('#') || line.trim() === '') return null;
  const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s*\/(.+)\/\s*$/);
  if (!match) return null;
  const [, traditional, simplified, pinyinRaw, defsStr] = match;
  const definitions = defsStr.split('/').filter((d) => d.length > 0);
  const pinyin = pinyinToToneMarks(pinyinRaw);
  return { t: traditional, s: simplified, p: pinyin, r: pinyinRaw, d: definitions };
}

describe('CC-CEDICT line parser', () => {
  it('parses a standard entry', () => {
    const line = '中國 中国 [Zhong1 guo2] /China/Middle Kingdom/';
    const entry = parseLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.t).toBe('中國');
    expect(entry!.s).toBe('中国');
    expect(entry!.r).toBe('Zhong1 guo2');
    expect(entry!.d).toEqual(['China', 'Middle Kingdom']);
  });

  it('parses entries with multiple definitions', () => {
    const line = '你好 你好 [ni3 hao3] /hello/hi/how are you/';
    const entry = parseLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.d).toEqual(['hello', 'hi', 'how are you']);
  });

  it('parses entries where traditional == simplified', () => {
    const line = '人 人 [ren2] /person/people/';
    const entry = parseLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.t).toBe('人');
    expect(entry!.s).toBe('人');
  });

  it('generates correct tone marks', () => {
    const line = '中國 中国 [Zhong1 guo2] /China/';
    const entry = parseLine(line);
    expect(entry!.p).toContain('guó');
  });

  it('skips comment lines', () => {
    expect(parseLine('# this is a comment')).toBeNull();
    expect(parseLine('#! commentary')).toBeNull();
  });

  it('skips blank lines', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
  });

  it('handles entries with special characters in definitions', () => {
    const line = 'T恤 T恤 [T xu4] /T-shirt/';
    const entry = parseLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.s).toBe('T恤');
    expect(entry!.d).toEqual(['T-shirt']);
  });
});

describe('longest-prefix matching algorithm', () => {
  // Simulate the lookup logic without IndexedDB
  const mockIndex = new Map<string, RawEntry[]>();

  beforeEach(() => {
    mockIndex.clear();
    const entries: [string, RawEntry][] = [
      ['中', { t: '中', s: '中', p: 'zhōng', r: 'zhong1', d: ['middle'] }],
      ['中国', { t: '中國', s: '中国', p: 'zhōng guó', r: 'Zhong1 guo2', d: ['China'] }],
      [
        '中华人民共和国',
        {
          t: '中華人民共和國',
          s: '中华人民共和国',
          p: 'zhōng huá rén mín gòng hé guó',
          r: 'Zhong1 hua2 ren2 min2 gong4 he2 guo2',
          d: ["People's Republic of China"],
        },
      ],
      ['人', { t: '人', s: '人', p: 'rén', r: 'ren2', d: ['person'] }],
      ['人民', { t: '人民', s: '人民', p: 'rén mín', r: 'ren2 min2', d: ['the people'] }],
    ];

    for (const [key, entry] of entries) {
      const list = mockIndex.get(key) || [];
      list.push(entry);
      mockIndex.set(key, list);
    }
  });

  function longestPrefixLookup(
    text: string,
    maxLen: number = 10
  ): { entries: RawEntry[]; matchLen: number } | null {
    const searchLen = Math.min(text.length, maxLen);
    for (let len = searchLen; len >= 1; len--) {
      const candidate = text.substring(0, len);
      const entries = mockIndex.get(candidate);
      if (entries && entries.length > 0) {
        return { entries, matchLen: len };
      }
    }
    return null;
  }

  it('matches the longest possible string', () => {
    const result = longestPrefixLookup('中华人民共和国是一个国家');
    expect(result).not.toBeNull();
    expect(result!.matchLen).toBe(7); // 中华人民共和国
    expect(result!.entries[0].d[0]).toBe("People's Republic of China");
  });

  it('falls back to shorter matches', () => {
    const result = longestPrefixLookup('中文');
    expect(result).not.toBeNull();
    expect(result!.matchLen).toBe(1); // 中 (no entry for 中文)
    expect(result!.entries[0].d[0]).toBe('middle');
  });

  it('matches 中国 correctly', () => {
    const result = longestPrefixLookup('中国人');
    expect(result).not.toBeNull();
    expect(result!.matchLen).toBe(2);
    expect(result!.entries[0].d[0]).toBe('China');
  });

  it('returns null for non-dictionary text', () => {
    const result = longestPrefixLookup('hello');
    expect(result).toBeNull();
  });

  it('respects maxLen parameter', () => {
    const result = longestPrefixLookup('中华人民共和国', 2);
    expect(result).not.toBeNull();
    // With maxLen=2, can only check 中华 and 中 — neither 中华 is in our mock
    // so falls back to 中
    expect(result!.matchLen).toBe(1);
  });
});
