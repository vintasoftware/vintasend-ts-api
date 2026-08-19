import { describe, expect, it } from 'vitest';

import { isOneIndexedBackend, toBackendPage } from '../src/domain/pagination.js';

describe('toBackendPage', () => {
  it('subtracts one for a zero-indexed backend', () => {
    expect(toBackendPage(1, { 'pagination.oneIndexed': false })).toBe(0);
    expect(toBackendPage(3, { 'pagination.oneIndexed': false })).toBe(2);
  });

  it('passes the page through for a one-indexed backend', () => {
    expect(toBackendPage(1, { 'pagination.oneIndexed': true })).toBe(1);
    expect(toBackendPage(3, { 'pagination.oneIndexed': true })).toBe(3);
  });

  it('treats a backend that reports nothing as zero-indexed', () => {
    // The capability defaults to false, and every TypeScript VintaSend backend
    // numbers its first page 0.
    expect(toBackendPage(1, {})).toBe(0);
    expect(isOneIndexedBackend({})).toBe(false);
  });
});
