import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** True when this module is the process entrypoint (tsx/node), false when imported. */
export function isDirectRun(metaUrl: string, argv: string[] = process.argv): boolean {
  const entry = argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === fileURLToPath(metaUrl);
  } catch {
    return false;
  }
}
