import { NextFunction, Request, Response } from 'express';
import express from 'express';
import config from './config.js';

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
app.post('/admin/reset', handlerRequestReset);
app.post('/api/validate_chirp', handlerValidateChirp);

// Catch all unknown routes → turn into NotFoundError
app.use((req, res, next) => {
  next(new NotFoundError('Route not found'));
});

// Global error handler - must be last
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

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

function handlerRequestReset(req: Request, res: Response): void {
  config.fileserverHits = 0;
  res.type('text').send(`Hits reseted to 0`);
}

async function handlerValidateChirp(
  req: Request,
  res: Response,
  next: NextFunction
) {
  type ValidateChirpParams = {
    body: string;
  };

  try {
    const { body }: ValidateChirpParams = req.body;

    if (typeof body !== 'string') {
      throw new BadRequestError('Invalid request body');
    }

    if (body.length > 140) {
      throw new BadRequestError('Chirp is too long');
    }

    const bannedWords = ['kerfuffle', 'sharbert', 'fornax'];

    const words = body.split(' ');

    const cleanedWords = words.map((word) => {
      const lower = word.toLocaleLowerCase();

      if (bannedWords.includes(lower)) {
        return '****';
      }
      return word;
    });

    const cleanedBody = cleanedWords.join(' ');

    return res.status(200).json({ cleanedBody });
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
