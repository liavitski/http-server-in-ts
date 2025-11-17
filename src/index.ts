import { NextFunction, Request, Response } from "express";
import express from "express";
import config from "./config.js";

const app = express();
const PORT = 8080;

app.use(
  "/app",
  middlewareMetricsInc,
  middlewareLogResponses,
  express.static("./src/app"),
);

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

function handlerReadiness(req: Request, res: Response): void {
  res.set("Content-Type", "text/plain").send("ok");
}

function handlerRequestCount(req: Request, res: Response): void {
  const count = config.fileserverHits;
  res.type("text").send(`Hits: ${count}`); 
}

function handlerRequestReset(req: Request, res: Response): void {
  config.fileserverHits = 0;
  res.type("text").send(`Hits reseted to 0`);
}

app.get("/healthz", handlerReadiness);
app.get("/metrics", handlerRequestCount);
app.get("/reset", handlerRequestReset);

function middlewareLogResponses(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.on("finish", () => {
    if (res.statusCode >= 400) {
      console.log(
        `[NON-OK] ${req.method} ${req.url} - Status: ${res.statusCode}`,
      );
    }
  });

  next();
}

function middlewareMetricsInc(req: Request, res: Response, next: NextFunction) {
  res.on("finish", () => {
    if (config.fileserverHits !== undefined) {
      config.fileserverHits++;
    }
  });

  next();
}
