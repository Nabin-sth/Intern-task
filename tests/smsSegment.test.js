import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeSms, detectSmsEncoding } from '../src/utils/smsSegment.js';

describe('analyzeSms encoding', () => {
  it('uses GSM-7 for standard English letters, digits, and common symbols', () => {
    const result = analyzeSms('Hello ABC 123 !?');
    assert.equal(result.encoding, 'gsm7');
    assert.equal(result.parts, 1);
  });

  it('switches the whole message to Unicode when any character is not GSM-7 (PDF emoji rule)', () => {
    const result = analyzeSms('Hello 😀');
    assert.equal(result.encoding, 'unicode');
    assert.equal(detectSmsEncoding('Hello 😀'), 'unicode');
  });

  it('uses Unicode for Nepali (Devanagari)', () => {
    assert.equal(analyzeSms('नमस्ते').encoding, 'unicode');
  });

  it('treats empty input as one GSM-7 part', () => {
    const result = analyzeSms('');
    assert.equal(result.encoding, 'gsm7');
    assert.equal(result.unitCount, 0);
    assert.equal(result.parts, 1);
  });

  it('rejects non-string input', () => {
    assert.throws(() => analyzeSms(null), TypeError);
  });
});

describe('analyzeSms PDF examples', () => {
  it('counts a 200-character English message as 2 parts (153 + 47)', () => {
    const result = analyzeSms('A'.repeat(200));
    assert.equal(result.encoding, 'gsm7');
    assert.equal(result.unitCount, 200);
    assert.equal(result.parts, 2);
  });

  it('counts a 100-character Nepali message as 2 parts (67 + 33)', () => {
    const result = analyzeSms('क'.repeat(100));
    assert.equal(result.encoding, 'unicode');
    assert.equal(result.unitCount, 100);
    assert.equal(result.parts, 2);
  });
});

describe('analyzeSms GSM-7 boundaries', () => {
  it('keeps 160 GSM-7 septets in one part', () => {
    assert.equal(analyzeSms('A'.repeat(160)).parts, 1);
  });

  it('splits 161 GSM-7 septets into 2 parts', () => {
    assert.equal(analyzeSms('A'.repeat(161)).parts, 2);
  });

  it('keeps 306 GSM-7 septets in 2 parts (153 * 2)', () => {
    assert.equal(analyzeSms('A'.repeat(306)).parts, 2);
  });

  it('splits 307 GSM-7 septets into 3 parts', () => {
    assert.equal(analyzeSms('A'.repeat(307)).parts, 3);
  });
});

describe('analyzeSms Unicode boundaries', () => {
  it('keeps 70 Unicode characters in one part', () => {
    assert.equal(analyzeSms('क'.repeat(70)).parts, 1);
  });

  it('splits 71 Unicode characters into 2 parts', () => {
    assert.equal(analyzeSms('क'.repeat(71)).parts, 2);
  });

  it('keeps 134 Unicode characters in 2 parts (67 * 2)', () => {
    assert.equal(analyzeSms('क'.repeat(134)).parts, 2);
  });

  it('splits 135 Unicode characters into 3 parts', () => {
    assert.equal(analyzeSms('क'.repeat(135)).parts, 3);
  });
});

describe('GSM-7 extension-table septets', () => {
  it('counts each extension character as two septets', () => {
    const chars = ['{', '}', '[', ']', '\\', '~', '|', '^', '€'];
    for (const char of chars) {
      const result = analyzeSms(char);
      assert.equal(result.encoding, 'gsm7', char);
      assert.equal(result.unitCount, 2, char);
      assert.equal(result.parts, 1, char);
    }
  });

  it('fits 80 braces in one part (160 septets) and splits at 81 (162 septets)', () => {
    assert.equal(analyzeSms('{'.repeat(80)).parts, 1);
    assert.equal(analyzeSms('{'.repeat(80)).unitCount, 160);
    assert.equal(analyzeSms('{'.repeat(81)).parts, 2);
    assert.equal(analyzeSms('{'.repeat(81)).unitCount, 162);
  });

  it('adds extension cost on top of basic characters', () => {
    const result = analyzeSms('Hi^{}');
    assert.equal(result.encoding, 'gsm7');
    assert.equal(result.unitCount, 2 + 2 + 2 + 2);
  });
});
