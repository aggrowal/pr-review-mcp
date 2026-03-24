import { createRequire } from "module";

const require = createRequire(import.meta.url);

interface PackageJsonLike {
  version?: string;
}

export function getServerVersion(): string {
  try {
    const pkg = require("../package.json") as PackageJsonLike;
    if (typeof pkg.version === "string" && pkg.version.trim().length > 0) {
      return pkg.version.trim();
    }
  } catch {
    // Fall through to deterministic fallback.
  }
  return "0.0.0";
}
