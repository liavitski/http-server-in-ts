import { describe, it, expect, beforeAll } from 'vitest';
import {
  checkPasswordHash,
  hashPassword,
  getBearerToken,
} from './auth';

describe('Password hashing', () => {
  const password1 = 'correctPassword123!';
  const password2 = 'anotherPassword456!';
  let hash1: string;
  let hash2: string;

  beforeAll(async () => {
    hash1 = await hashPassword(password1);
    hash2 = await hashPassword(password2);
  });

  it('should return true for the correct password', async () => {
    const result = await checkPasswordHash(password1, hash1);
    expect(result).toBe(true);
  });

  it('should return false for the incorrect password', async () => {
    const result1 = await checkPasswordHash(password1, hash2);
    const result2 = await checkPasswordHash(password2, hash1);
    expect(result1).toBe(false);
    expect(result2).toBe(false);
  });
});

describe('getBearerToken', () => {
  it('returns the token when Authorization header is valid', () => {
    const req = {
      get: (name: string) =>
        name.toLowerCase() === 'authorization'
          ? 'Bearer abc123'
          : null,
    } as any;

    expect(getBearerToken(req)).toBe('abc123');
  });

  it('throws when Authorization header is missing', () => {
    const req = {
      get: () => null,
    } as any;

    expect(() => getBearerToken(req)).toThrow(
      'Missing Authorization header'
    );
  });

  it('throws when Authorization header does not start with Bearer', () => {
    const req = {
      get: () => 'Token abc123',
    } as any;

    expect(() => getBearerToken(req)).toThrow(
      'Invalid Authorization header format'
    );
  });

  it('throws when token part is empty', () => {
    const req = {
      get: () => 'Bearer   ',
    } as any;

    expect(() => getBearerToken(req)).toThrow('Missing token');
  });
});
