import { NextFunction, Request, Response } from 'express';
import express from 'express';
import { db } from './db/client.js';
import { users, chirps, refreshTokens } from './db/schema.js';
import { isNull, sql, eq, asc, and, gt } from 'drizzle-orm';

import {
  checkPasswordHash,
  getBearerToken,
  hashPassword,
  makeJWT,
  makeRefreshToken,
  validateJWT,
} from './auth.js';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { config } from './db/migrationConfig.js';
import { randomUUID } from 'node:crypto';
import { REFRESH_TOKEN_EXPIRY_MS } from './constants.js';
import { ref } from 'node:process';
import { envOrThrow } from './utils.js';

// Database will be up-to-date whenever server starts
const migrationClient = postgres(config.db.url, { max: 1 });
await migrate(drizzle(migrationClient), config.db.migrationConfig);

const app = express();
const PORT = 8080;

// Body parser for all json routes
app.use(express.json());

app.use(
  '/app',
  middlewareLogResponses,
  middlewareMetricsInc,
  express.static('./src/app')
);

// Routes
app.get('/api/healthz', handlerReadiness);
app.get('/admin/metrics', handlerRequestCount);
app.get('/api/chirps', handlerGetAllChirps);
app.get('/api/chirps/:chirpID', handlerGetChirp);

app.post('/admin/reset', handlerRequestReset);
app.post('/api/users', handlerUsers);
app.post('/api/chirps', handlerCreateChirp);
app.post('/api/login', handlerLogin);
app.post('/api/refresh', handlerRefresh);
app.post('/api/revoke', handlerRevoke);

app.put('/api/users', handlerUpdate);

// Catch all unknown routes → turn into NotFoundError
app.use((req, res, next) => {
  next(new NotFoundError('Route not found'));
});

// Global error handler - must be last
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

type UserEmail = {
  email: string;
  password: string;
};

type RequestBody = {
  password: string;
  email: string;
  expiresInSeconds?: number;
};

const allUsers = await db.select().from(users);
console.log(allUsers);

class AppError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Chirp is too long. Max length is 140') {
    super(message, 400);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Not Found') {
    super(message, 404);
  }
}

function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const status = err.status ?? 500;
  const message = err.message ?? 'Something went wrong';

  res.status(status).json({ error: message });
}

async function handlerUpdate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // 1. Validate authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res
        .status(401)
        .json({ message: 'Missing or invalid token' });
    }

    const accessToken = authHeader.split(' ')[1];

    // 2. Verify and decode access token. This must return the authenticated user ID.
    let authenticatedUserId;
    try {
      authenticatedUserId = validateJWT(
        accessToken,
        envOrThrow('SECRET_KEY')
      );
    } catch {
      return res
        .status(401)
        .json({ message: 'Invalid or expired token' });
    }

    // 3. Validate request body
    const { password, email } = req.body as RequestBody;

    if (typeof email !== 'string') {
      throw new BadRequestError('Invalid email');
    }

    if (typeof password !== 'string' || password.length < 8) {
      throw new BadRequestError(
        'Password must be at least 8 characters long'
      );
    }

    // 4. Hash password
    const hashedPassword = await hashPassword(password);

    // 5. Update authenticated user's record
    const [updatedUser] = await db
      .update(users)
      .set({ email, hashedPassword, updatedAt: new Date() })
      .where(eq(users.id, authenticatedUserId))
      .returning({
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    // 6. Respond with the updated user (no password)
    return res.status(200).json(updatedUser);
  } catch (err) {
    next(err);
  }
}

async function handlerRevoke(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res
        .status(401)
        .json({ message: 'Missing or invalid token' });
    }

    const token = authHeader.split(' ')[1];

    // Look up the refresh token in DB

    const [refreshTokenRow] = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.token, token),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!refreshTokenRow) {
      return res
        .status(401)
        .json({ message: 'Invalid or expired token' });
    }

    // Revoke token: update revokedAt and updatedAt
    await db
      .update(refreshTokens)
      .set({
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(refreshTokens.token, token));

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function handlerRefresh(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res
        .status(401)
        .json({ message: 'Missing or invalid token' });
    }

    const token = authHeader.split(' ')[1];

    // Look up the refresh token in DB
    const [refreshTokenRow] = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.token, token),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!refreshTokenRow) {
      return res
        .status(401)
        .json({ message: 'Invalid or expired token' });
    }

    // Get the user from the token
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        hashedPassword: users.hashedPassword,
      })
      .from(refreshTokens)
      .leftJoin(users, eq(users.id, refreshTokens.userId))
      .where(
        and(
          eq(refreshTokens.token, token),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!user || !user.id) {
      return res.status(401).json({ message: 'User not found' });
    }

    const newToken = makeJWT(user.id, config.secretKey);

    return res.status(200).json({ token: newToken });
  } catch (err) {
    next(err);
  }
}

async function handlerLogin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    let { password, email, expiresInSeconds } =
      req.body as RequestBody;

    if (!expiresInSeconds || expiresInSeconds > 3600) {
      expiresInSeconds = 3600;
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res
        .status(401)
        .json({ message: 'Incorrect email or password' });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return res
        .status(401)
        .json({ message: 'Incorrect email or password' });
    }

    const valid = await checkPasswordHash(
      password,
      user.hashedPassword
    );

    if (!valid) {
      return res
        .status(401)
        .json({ message: 'Incorrect email or password' });
    }

    const token = makeJWT(user.id, config.secretKey);
    const refreshToken = makeRefreshToken();

    // compute expiresAt for Refresh Token from expiresInSeconds (Date object)
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

    // Add Refresh Token to DB
    await db.insert(refreshTokens).values({
      token: refreshToken,
      userId: user.id,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
      revokedAt: null,
    });

    return res.status(200).json({
      user: {
        id: user.id,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        email: user.email,
        token,
        refreshToken,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function handlerGetChirp(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { chirpID } = req.params;

    if (!chirpID) {
      return res.status(400).json({ error: 'Missing chirpId param' });
    }

    const result = await db
      .select()
      .from(chirps)
      .where(eq(chirps.id, chirpID));

    if (result.length === 0) {
      return res.status(404).json({ error: 'Chirp not found' });
    }

    return res.status(200).json(result[0]);
  } catch (err) {
    next(err);
  }
}

async function handlerGetAllChirps(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userChirps = await db
      .select()
      .from(chirps)
      .where(
        eq(chirps.userId, 'a7beba88-5ae5-4658-8f40-cf94e47fdbec')
      )
      .orderBy(asc(chirps.createdAt));

    return res.status(200).json({ userChirps });
  } catch (err) {
    next(err);
  }
}

async function handlerCreateChirp(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { body, userId }: { body: string; userId: string } =
      req.body;

    const userToken = getBearerToken(req);
    validateJWT(userToken, config.secretKey);

    // Validate input
    if (!userId || typeof body !== 'string' || body.length === 0) {
      throw new BadRequestError('Invalid request body');
    }

    if (body.length > 140) {
      throw new BadRequestError('Chirp is too long');
    }

    // Clean banned words
    const bannedWords = ['kerfuffle', 'sharbert', 'fornax'];
    const cleanedBody = body
      .split(' ')
      .map((word) =>
        bannedWords.includes(word.toLowerCase()) ? '****' : word
      )
      .join(' ');

    // Insert chirp
    const [chirp] = await db
      .insert(chirps)
      .values({
        id: randomUUID(),
        userId,
        body: cleanedBody, // only insert columns you need
      })
      .returning();

    return res.status(201).json({ chirp }); // 201 Created
  } catch (err) {
    next(err);
  }
}

async function handlerUsers(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { email, password } = req.body as UserEmail;

    if (typeof email !== 'string') {
      throw new BadRequestError('Invalid email');
    }

    if (typeof password !== 'string' || password.length < 8) {
      throw new BadRequestError(
        'Password must be at least 8 characters long'
      );
    }

    const hashed = await hashPassword(password);

    const [user] = await db
      .insert(users)
      .values({ email, hashedPassword: hashed })
      .returning({
        id: users.id,
        email: users.email,
      });

    return res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

function handlerReadiness(req: Request, res: Response): void {
  res.set('Content-Type', 'text/plain').send('ok');
}

function handlerRequestCount(req: Request, res: Response): void {
  const count = config.fileserverHits;

  const html = `
  <html>
    <body>
      <h1>Welcome, Chirpy Admin</h1>
      <p>Chirpy has been visited ${count} times!</p>
    </body>
  </html>
  `;

  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
}

async function handlerRequestReset(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    if (config.db.platform !== 'dev') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await db.execute(sql`DELETE FROM "users"`);

    return res.status(200).json({ message: 'All users deleted' });
  } catch (err) {
    next(err);
  }
}

function middlewareLogResponses(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      console.log(
        `[NON-OK] ${req.method} ${req.url} - Status: ${res.statusCode}`
      );
    }
  });

  next();
}

function middlewareMetricsInc(
  req: Request,
  res: Response,
  next: NextFunction
) {
  res.on('finish', () => {
    if (config.fileserverHits !== undefined) {
      config.fileserverHits++;
    }
  });

  next();
}
