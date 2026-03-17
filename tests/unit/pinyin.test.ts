import { describe, it, expect } from 'vitest';
import {
  numberToToneMark,
  pinyinToToneMarks,
  getToneNumber,
  splitPinyin,
} from '../../src/common/pinyin';

describe('numberToToneMark', () => {
  it('converts tone 1 (macron)', () => {
    expect(numberToToneMark('zhong1')).toBe('zhōng');
    expect(numberToToneMark('ma1')).toBe('mā');
  });

  it('converts tone 2 (acute)', () => {
    expect(numberToToneMark('guo2')).toBe('guó');
    expect(numberToToneMark('ma2')).toBe('má');
  });

  it('converts tone 3 (caron)', () => {
    expect(numberToToneMark('ni3')).toBe('nǐ');
    expect(numberToToneMark('hao3')).toBe('hǎo');
  });

  it('converts tone 4 (grave)', () => {
    expect(numberToToneMark('shi4')).toBe('shì');
    expect(numberToToneMark('da4')).toBe('dà');
  });

  it('handles tone 5 (neutral)', () => {
    expect(numberToToneMark('de5')).toBe('de');
    expect(numberToToneMark('ma5')).toBe('ma');
  });

  it('places tone on a/e when present', () => {
    expect(numberToToneMark('bai2')).toBe('bái');
    expect(numberToToneMark('mei2')).toBe('méi');
  });

  it('places tone on o in ou', () => {
    expect(numberToToneMark('dou1')).toBe('dōu');
    expect(numberToToneMark('gou3')).toBe('gǒu');
  });

  it('handles ü (v notation)', () => {
    expect(numberToToneMark('lv4')).toBe('lǜ');
    expect(numberToToneMark('nv3')).toBe('nǚ');
  });

  it('returns unrecognized syllables unchanged', () => {
    expect(numberToToneMark('r5')).toBe('r5'); // edge case
    expect(numberToToneMark('hello')).toBe('hello');
    expect(numberToToneMark('')).toBe('');
  });
});

describe('pinyinToToneMarks', () => {
  it('converts full pinyin strings', () => {
    expect(pinyinToToneMarks('zhong1 guo2')).toBe('zhōng guó');
    expect(pinyinToToneMarks('ni3 hao3')).toBe('nǐ hǎo');
  });

  it('handles single syllables', () => {
    expect(pinyinToToneMarks('shi4')).toBe('shì');
  });

  it('handles mixed tones', () => {
    expect(pinyinToToneMarks('zhong1 hua2 ren2 min2 gong4 he2 guo2')).toBe(
      'zhōng huá rén mín gòng hé guó'
    );
  });
});

describe('getToneNumber', () => {
  it('extracts tone numbers', () => {
    expect(getToneNumber('zhong1')).toBe(1);
    expect(getToneNumber('guo2')).toBe(2);
    expect(getToneNumber('hao3')).toBe(3);
    expect(getToneNumber('shi4')).toBe(4);
    expect(getToneNumber('de5')).toBe(5);
  });

  it('defaults to 5 for no tone', () => {
    expect(getToneNumber('hello')).toBe(5);
  });
});

describe('splitPinyin', () => {
  it('splits space-separated syllables', () => {
    expect(splitPinyin('ni3 hao3')).toEqual(['ni3', 'hao3']);
    expect(splitPinyin('zhong1')).toEqual(['zhong1']);
  });

  it('handles extra whitespace', () => {
    expect(splitPinyin('  ni3  hao3  ')).toEqual(['ni3', 'hao3']);
  });
});
