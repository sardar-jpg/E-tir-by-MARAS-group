/**
 * hash-password.ts
 *
 * One-off CLI helper: generates a PBKDF2 password hash in the exact format
 * the server expects for SUPER_ADMIN_PASSWORD_HASH (and for manually
 * resetting any admin/driver/client's password field directly in Firestore
 * if ever needed).
 *
 * Usage:
 *   npx tsx scripts/hash-password.ts
 *   (it will prompt for a password — input is hidden, not echoed to the
 *   terminal or logged anywhere)
 *
 * Copy the printed hash into your .env file as SUPER_ADMIN_PASSWORD_HASH,
 * or paste it into the `password` field of a document in Firestore.
 * Never put the plaintext password itself anywhere — only this hash.
 */
import crypto from "crypto";
import readline from "readline";

function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(plain, salt, 100_000, 64, "sha256").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

function promptHiddenPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // @ts-ignore - accessing internal _writeToOutput to mask input characters
    const originalWrite = (rl as any)._writeToOutput;
    let masked = true;
    (rl as any)._writeToOutput = function (stringToWrite: string) {
      if (masked && stringToWrite.charCodeAt(0) !== 13 && stringToWrite.charCodeAt(0) !== 10) {
        (rl as any).output.write("*");
      } else {
        originalWrite.call(rl, stringToWrite);
      }
    };
    rl.question(question, (answer) => {
      masked = false;
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const password = await promptHiddenPassword("Enter the password to hash: ");
  if (!password || password.length < 8) {
    console.error("\nPassword must be at least 8 characters. Run again with a stronger password.");
    process.exit(1);
  }
  const hash = hashPassword(password);
  console.log("\n\nAdd this to your .env file:\n");
  console.log(`SUPER_ADMIN_PASSWORD_HASH=${hash}`);
  console.log("\n(This is a one-way hash — the plaintext password cannot be recovered from it. Store the actual password in your own password manager separately.)");
}

main();
