
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from './database.service.js';

describe('DatabaseService', () => {
  let service: DatabaseService;
  let module: TestingModule;

  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(async () => {
    // Supply a valid test URL so the constructor can initialize.
    // This does not connect to a real database.
    process.env.DATABASE_URL =
      'postgresql://test:test@localhost:5432/test_db';

    module = await Test.createTestingModule({
      providers: [DatabaseService],
    }).compile();

    service = module.get<DatabaseService>(DatabaseService);
  });

  afterEach(async () => {
    // Restore the original environment variable.
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    await module?.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
