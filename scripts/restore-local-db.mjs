import { copyFile, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const source = process.argv[2];

if (!source) {
  throw new Error("Usage: npm run db:restore -- <backup.db>");
}

const sourcePath = resolve(source);
const targetDir = resolve("orchestrator/data");
const targetPath = resolve(targetDir, "jobs.db");

if (sourcePath === targetPath) {
  throw new Error("The backup must not be the active local database.");
}

const sourceStat = await stat(sourcePath);
if (!sourceStat.isFile()) {
  throw new Error(`Backup is not a file: ${sourcePath}`);
}

await mkdir(targetDir, { recursive: true });
await copyFile(sourcePath, targetPath);
console.log(`Restored local database from ${sourcePath}`);
