import fs from 'fs';
import path from 'path';
import { getTestDatabase, closeDatabase } from '../src/database/connection';
import { runMigrations } from '../src/database/migrate';

let testDb: any;

jest.mock('../src/database/connection', () => {
  const actual = jest.requireActual('../src/database/connection');
  return {
    ...actual,
    getDatabase: () => testDb
  };
});

export function setupTestDatabase() {
  testDb = getTestDatabase();
  
  // Force require the migration script to run on our test DB
  runMigrations(testDb);

  return testDb;
}

export function teardownTestDatabase() {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}


