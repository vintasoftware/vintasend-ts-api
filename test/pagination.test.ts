import { describe, expect, it } from 'vitest';

import { isZeroIndexedBackend, toBackendPage } from '../src/domain/pagination.js';

describe('toBackendPage', () => {
  it('subtracts one for a zero-indexed backend', () => {
    expect(toBackendPage(1, { 'pagination.zeroIndexed': true })).toBe(0);
    expect(toBackendPage(3, { 'pagination.zeroIndexed': true })).toBe(2);
  });

  it('passes the page through for a one-indexed backend', () => {
    expect(toBackendPage(1, { 'pagination.zeroIndexed': false })).toBe(1);
    expect(toBackendPage(3, { 'pagination.zeroIndexed': false })).toBe(3);
  });

  it('treats a backend that reports nothing as zero-indexed', () => {
    // Backends without getFilterCapabilities() get the defaults, and every
    // TypeScript VintaSend backend is zero-indexed.
    expect(toBackendPage(1, {})).toBe(0);
    expect(isZeroIndexedBackend({})).toBe(true);
  });
});
