import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { R2StorageService } from './r2-storage.service.js';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(() => 'https://signed.example.test/object'),
}));

describe('R2StorageService', () => {
  let service: R2StorageService;

  const makeConfig = (overrides: Record<string, unknown> = {}) => ({
    get: vi.fn((key: string) => {
      const values: Record<string, unknown> = {
        R2_ENDPOINT: undefined,
        R2_ACCOUNT_ID: 'test-account',
        R2_BUCKET_NAME: 'test-bucket',
        R2_ACCESS_KEY_ID: 'test-access-key',
        R2_SECRET_ACCESS_KEY: 'test-secret-key',
        R2_REGION: 'auto',
        R2_FORCE_PATH_STYLE: true,
        ...overrides,
      };

      return values[key];
    }),
    getOrThrow: vi.fn((key: string) => {
      const values: Record<string, unknown> = {
        R2_ACCOUNT_ID: 'test-account',
        R2_BUCKET_NAME: 'test-bucket',
        R2_ACCESS_KEY_ID: 'test-access-key',
        R2_SECRET_ACCESS_KEY: 'test-secret-key',
        ...overrides,
      };

      return values[key];
    }),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        R2StorageService,
        {
          provide: ConfigService,
          useValue: makeConfig(),
        },
      ],
    }).compile();

    service = module.get<R2StorageService>(R2StorageService);
  });

  it('initializes the Cloudflare R2 client with the expected defaults', async () => {
    expect(service).toBeDefined();
    expect((service as any).bucket).toBe('test-bucket');
    expect((service as any).client).toBeDefined();
  });

  it('uses a custom endpoint and local S3 path style when R2_ENDPOINT is set', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        R2StorageService,
        {
          provide: ConfigService,
          useValue: makeConfig({
            R2_ENDPOINT: 'http://localhost:9000',
            R2_FORCE_PATH_STYLE: true,
          }),
        },
      ],
    }).compile();

    const localService = module.get<R2StorageService>(R2StorageService);
    expect((localService as any).client.config.isCustomEndpoint).toBe(true);
    expect((localService as any).client.config.forcePathStyle).toBe(true);
  });

  it('creates a signed upload URL for an object and includes the bucket and key', async () => {
    const url = await service.createUploadUrl('merchant/kyc/file.pdf', 'application/pdf');

    expect(getSignedUrl).toHaveBeenCalled();
    expect(url).toBe('https://signed.example.test/object');
  });

  it('creates a downloadable signed URL for a storage object', async () => {
    await service.createDownloadUrl('merchant/kyc/file.pdf', 600);

    const [client, command, options] = vi.mocked(getSignedUrl).mock.calls.at(-1) ?? [];

    expect(client).toBeDefined();
    expect(command).toBeDefined();
    expect((command as any)?.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'merchant/kyc/file.pdf',
    });
    expect(options).toMatchObject({ expiresIn: 600 });
  });

  it('creates a preview URL with inline disposition', async () => {
    await service.createPreviewUrl('merchant/kyc/file.pdf');

    const [client, command, options] = vi.mocked(getSignedUrl).mock.calls.at(-1) ?? [];

    expect(client).toBeDefined();
    expect((command as any)?.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'merchant/kyc/file.pdf',
      ResponseContentDisposition: 'inline',
    });
    expect(options).toMatchObject({ expiresIn: 300 });
  });

  it('reads file metadata through head-object and surfaces the remote response', async () => {
    const sendSpy = vi.spyOn((service as any).client, 'send').mockResolvedValue({ ContentLength: 42 });

    await expect(service.getObjectMetadata('merchant/kyc/file.pdf')).resolves.toEqual({ ContentLength: 42 });
    expect(sendSpy).toHaveBeenCalled();
  });

  it('throws when a file has no readable body in readFileSignature', async () => {
    vi.spyOn((service as any).client, 'send').mockResolvedValue({ Body: null });

    await expect(service.readFileSignature('merchant/kyc/file.pdf')).rejects.toThrow(
      'Uploaded object has no readable body',
    );
  });

  it('deletes an object with the expected bucket and key', async () => {
    const sendSpy = vi.spyOn((service as any).client, 'send').mockResolvedValue(undefined);

    await service.deleteObject('merchant/kyc/file.pdf');

    expect(sendSpy).toHaveBeenCalled();
  });

  it('checks the bucket on module init and rethrows failures', async () => {
    const sendSpy = vi.spyOn((service as any).client, 'send').mockResolvedValue({});
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(sendSpy).toHaveBeenCalled();

    vi.spyOn((service as any).client, 'send').mockRejectedValue(new Error('down'));
    await expect(service.onModuleInit()).rejects.toThrow('down');
  });
});
