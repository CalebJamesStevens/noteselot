import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
let database, socket;
let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  database = await PGlite.create(".dev-db");
  socket = new PGLiteSocketServer({
    db: database,
    port: 5433,
    host: "127.0.0.1",
  });
  await socket.start();
  connectionString = "postgres://postgres:postgres@127.0.0.1:5433/postgres";
}
const env = {
  ...process.env,
  DATABASE_URL: connectionString,
  DB_POOL_SIZE: database ? "1" : "10",
  APP_URL: process.env.APP_URL || "http://localhost:5173",
};
const api = spawn(process.execPath, ["server/index.js"], {
  env,
  stdio: "inherit",
});
const vite = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "0.0.0.0",
    ...process.argv.slice(2),
  ],
  { env, stdio: "inherit" },
);
async function stop() {
  api.kill("SIGTERM");
  vite.kill("SIGTERM");
  await socket?.stop();
  await database?.close();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
api.on("exit", (code) => {
  if (code) {
    console.error("API stopped unexpectedly");
    void stop();
  }
});
