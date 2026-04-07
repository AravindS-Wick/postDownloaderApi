/**
 * Seed script to create test users with all 4 roles for UI testing.
 * Run with: npx ts-node src/scripts/seedTestUsers.ts
 */

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../..');
const DB_PATH = path.join(DATA_DIR, 'db', 'app.db');

// Ensure db directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Test user credentials
const TEST_PASSWORD = 'TestPassword123!';
const TEST_USERS = [
  {
    email: 'admin@test.com',
    name: 'Admin User',
    role: 'admin' as const,
    description: 'Full system access with user management and oversight',
  },
  {
    email: 'owner@test.com',
    name: 'Owner User',
    role: 'owner' as const,
    description: 'Full system access equivalent to admin',
  },
  {
    email: 'tester@test.com',
    name: 'Tester User',
    role: 'tester' as const,
    description: 'Limited admin access for QA testing',
  },
  {
    email: 'user@test.com',
    name: 'Regular User',
    role: 'user' as const,
    description: 'Basic download and file management',
  },
];

async function seedUsers() {
  console.log('🌱 Seeding test users...\n');

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
  const now = Date.now();

  for (const testUser of TEST_USERS) {
    try {
      // Check if user already exists
      const existing = db
        .prepare('SELECT email FROM users WHERE email = ?')
        .get(testUser.email);

      if (existing) {
        // Update existing user
        db.prepare(
          `UPDATE users SET role = ?, is_verified = 1, verification_code = NULL, verification_expires = NULL
           WHERE email = ?`
        ).run(testUser.role, testUser.email);
        console.log(`✓ Updated ${testUser.email} with role: ${testUser.role}`);
      } else {
        // Create new user
        db.prepare(
          `INSERT INTO users (
            email, password, created_at, role, is_blocked, monthly_downloads,
            month_reset_at, is_verified, verification_code, verification_expires
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          testUser.email,
          passwordHash,
          now,
          testUser.role,
          0, // is_blocked
          0, // monthly_downloads
          0, // month_reset_at
          1, // is_verified
          null, // verification_code
          null // verification_expires
        );
        console.log(`✓ Created ${testUser.email} with role: ${testUser.role}`);
      }
    } catch (error) {
      console.error(`✗ Error with ${testUser.email}:`, error);
    }
  }

  console.log(`\n📋 Test Users Created:\n`);
  TEST_USERS.forEach((u) => {
    console.log(`  Email: ${u.email}`);
    console.log(`  Password: ${TEST_PASSWORD}`);
    console.log(`  Role: ${u.role}`);
    console.log(`  Description: ${u.description}\n`);
  });

  console.log('✅ Seeding complete!');
  db.close();
}

seedUsers().catch((error) => {
  console.error('❌ Seed failed:', error);
  process.exit(1);
});
