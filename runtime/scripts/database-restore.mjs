#!/usr/bin/env node
import {
  DATABASE_RESTORE_CONFIRMATION,
  restoreVerifiedDatabaseBackup
} from "../dist/databaseBackup.js";

const [manifestPath, targetDatabasePath, confirmation, ...extra] = process.argv.slice(2);
if (!manifestPath || !targetDatabasePath || !confirmation || extra.length > 0) {
  console.error(
    "Usage: npm run database:restore -- <manifest.json> <database.sqlite> RestoreForgeDatabaseBackup"
  );
  process.exitCode = 64;
} else if (confirmation !== DATABASE_RESTORE_CONFIRMATION) {
  console.error(`Restore refused: confirmation must be ${DATABASE_RESTORE_CONFIRMATION}.`);
  process.exitCode = 64;
} else {
  const receipt = restoreVerifiedDatabaseBackup({
    manifestPath,
    targetDatabasePath,
    confirmation
  });
  console.log("Forge database restore completed and verified.");
  console.log(`- Schema version: ${receipt.restoredSchemaVersion}`);
  console.log(`- Tasks: ${receipt.restoredTaskCount}`);
  console.log(`- SHA-256: ${receipt.restoredSha256}`);
  console.log(`- Displaced database: ${receipt.displacedDatabasePath ?? "none"}`);
  console.log(`- Receipt: ${receipt.receiptPath}`);
}
