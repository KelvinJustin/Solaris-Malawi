import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { describe, beforeEach, expect, it, vi } from 'vitest';

import { R2StorageService } from './r2-storage.service.js';

describe('R2StorageService', () => {
  let service: R2StorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        R2StorageService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: vi.fn((key: string) => {
              const values: Record<string, string> = {
                R2_ACCOUNT_ID: 'test-account',
                R2_BUCKET_NAME: 'test-bucket',
                R2_ACCESS_KEY_ID: 'test-access-key',
                R2_SECRET_ACCESS_KEY: 'test-secret-key',
              };

              return values[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<R2StorageService>(R2StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
