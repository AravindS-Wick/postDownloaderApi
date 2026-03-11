/**
 * Seed script: creates pre-set admin, owner, and tester accounts.
 * Run with: npm run seed
 * Safe to re-run — deletes and recreates each account on every run.
 */

import bcrypt from 'bcryptjs';
import { createUser, deleteUser, userExists, deleteUserDownloads } from '../src/db/database.js';

const ACCOUNTS = [
  { email: 'admin@socialsaver.internal', password: 'AdminPass123!', role: 'admin' as const },
  { email: 'owner@socialsaver.internal', password: 'OwnerPass123!', role: 'owner' as const },
  { email: 'tester@socialsaver.internal', password: 'TesterPass123!', role: 'tester' as const },
];

async function seed() {
  console.log('Seeding accounts...');

  for (const account of ACCOUNTS) {
    // Delete if exists (idempotent re-run)
    if (userExists(account.email)) {
      deleteUserDownloads(account.email);
      deleteUser(account.email);
      console.log(`  Removed existing: ${account.email}`);
    }

    const hash = await bcrypt.hash(account.password, 10);
    createUser(account.email, hash, account.role);
    console.log(`  Created [${account.role}]: ${account.email}`);
  }

  console.log('\nSeed complete. Accounts:');
  for (const a of ACCOUNTS) {
    console.log(`  ${a.role.padEnd(7)} ${a.email}  /  ${a.password}`);
  }

  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
