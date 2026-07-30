// ============================================================
// scripts/hash-password.ts
//
// Turns the admin password into the bcrypt hash that goes in
// $ADMIN_PASSWORD_HASH.
//
// USAGE:
//   npm run hash:password -- 'the password'
//
// The password is read from argv rather than prompted because this tool
// is also run in non-interactive shells. That does put it in your shell
// history — clear it afterwards, or prefix the command with a space if
// your shell is configured to skip those.
//
// The plaintext is never written anywhere by this script: it prints the
// hash and nothing else.
// ============================================================

import bcrypt from "bcryptjs";

// 12 rounds: comfortably above bcrypt's decade-old default of 10, and
// still fast enough that an admin sign-in does not stall a serverless
// function. This is a single account, so the cost is paid once per login.
const ROUNDS = 12;

const password = process.argv[2];

if (!password) {
  console.error("usage: npm run hash:password -- '<password>'");
  process.exit(1);
}

if (password.length < 12) {
  console.error(
    `Refusing to hash a ${password.length}-character password. ` +
      "This is the only credential that bypasses GitHub sign-in; use at least 12 characters.",
  );
  process.exit(1);
}

const hash = bcrypt.hashSync(password, ROUNDS);

// Base64, not the raw hash. Next.js expands `$VAR` when it loads a .env
// file, and a bcrypt hash is full of `$` — pasting one raw silently
// truncates it. See lib/auth/admin.ts for the full story.
const encoded = Buffer.from(hash, "utf8").toString("base64");

console.log("\nAdd this to your environment (and to Vercel):\n");
console.log(`ADMIN_PASSWORD_HASH=${encoded}\n`);
console.log(
  "(base64-encoded — a raw bcrypt hash cannot survive a .env file,\n" +
    " because Next.js reads its $ segments as variable references.)\n",
);
