import dotenv from "dotenv";
import path from "path";

// Local development reads secrets (e.g. SESSION_SECRET) from .env.local and
// .env so `npm run dev` works without exporting them by hand. dotenv's
// default `override: false` means these never clobber a real environment
// variable already set by the host, so production — which sets
// SESSION_SECRET via the platform's environment, not a file — is unaffected.
// This must be imported before any module (e.g. dd-trace) that reads
// process.env at import time; being a side-effect-only import keeps it
// first in evaluation order the same way the previous `import
// "dotenv/config"` was.
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
