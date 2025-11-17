import { NextFunction, Request, Response } from "express";
import express from "express";

const app = express();
const PORT = 8080;

app.use("/app", middlewareLogResponses, express.static("./src/app"));

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

function handlerReadiness(req: Request, res: Response): void {
  res.set("Content-Type", "text/plain").send("ok");
}

app.get("/healthz", handlerReadiness);

function middlewareLogResponses(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.on("finish", () => {
    if (res.statusCode >= 300) {
      console.log(
        `[NON-OK] ${req.method} ${req.url} - Status: ${res.statusCode}`,
      );
    }
  });

  next();
}
