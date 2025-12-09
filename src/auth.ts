import argon2 from 'argon2';
import { JwtPayload } from 'jsonwebtoken';
import jwt from 'jsonwebtoken';
import { NextFunction, Request } from 'express';
import { randomBytes } from 'crypto';

export async function hashPassword(
  password: string
): Promise<string> {
  return await argon2.hash(password);
}

export async function checkPasswordHash(
  password: string,
  hash: string
): Promise<boolean> {
  return argon2.verify(hash, password);
}

type Payload = Pick<JwtPayload, 'iss' | 'sub' | 'iat' | 'exp'>;

export function makeJWT(userID: string, secret: string): string {
  const iat = Math.floor(Date.now() / 1000); // convert to seconds

  const payload: Payload = {
    iss: 'chirpy',
    sub: userID,
    iat,
    exp: iat + 3600, // 1 hour later
  };

  return jwt.sign(payload, secret);
}

export function validateJWT(
  tokenString: string,
  secret: string
): string {
  let decoded: JwtPayload;

  try {
    decoded = jwt.verify(tokenString, secret) as JwtPayload;
  } catch {
    throw new Error('Invalid or expired token');
  }

  if (typeof decoded.sub !== 'string') {
    throw new Error('Token payload missing subject');
  }

  return decoded.sub;
}

export function getBearerToken(req: Request): string {
  const header = req.get('Authorization');
  if (!header) {
    throw new Error('Missing Authorization header');
  }

  const prefix = 'Bearer';
  if (!header.startsWith(prefix)) {
    throw new Error('Invalid Authorization header format');
  }

  const token = header.slice(prefix.length).trim();

  if (!token) {
    throw new Error('Missing token');
  }

  return token;
}

export function makeRefreshToken(): string {
  return randomBytes(32).toString('hex');
}