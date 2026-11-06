import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    // Fail immediately if database configuration is missing.
    if (!connectionString) {
      throw new Error(
        '[Database] DATABASE_URL is missing. Check your environment configuration.',
      );
    }

    // Configure Prisma to connect to PostgreSQL using node-postgres.
    const adapter = new PrismaPg({ connectionString });

    super({ adapter });
  }

  /**
   * Establishes the database connection and verifies that PostgreSQL
   * can execute a query before the application starts serving requests.
   *
   * Startup fails if connection, authentication, or verification fails.
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing PostgreSQL connection...');

    try {
      // Establish the connection.
      await this.$connect();

      this.logger.log(
        'PostgreSQL connection established. Verifying database access...',
      );

      // Verify that queries work and identify the actual database/server.
      const [databaseInfo] = await this.$queryRaw<
        Array<{
          database: string;
          username: string;
          server_address: string | null;
          server_port: number;
          server_version: string;
        }>
      >`
        SELECT
          current_database() AS database,
          current_user AS username,
          inet_server_addr()::text AS server_address,
          inet_server_port() AS server_port,
          current_setting('server_version') AS server_version
      `;

      if (!databaseInfo) {
        throw new Error(
          'Database verification returned no server information.',
        );
      }

      this.logger.log('PostgreSQL database verified successfully.');
      this.logger.log(
        `Database: ${databaseInfo.database} | User: ${databaseInfo.username}`,
      );
      this.logger.log(
        `Server: ${databaseInfo.server_address ?? 'local socket'}:${databaseInfo.server_port}`,
      );
      this.logger.log(`PostgreSQL version: ${databaseInfo.server_version}`);
    } catch (error: unknown) {
      const details =
        error instanceof Error
          ? error.message
          : 'An unknown database error occurred.';

      this.logger.error(
        `PostgreSQL initialization failed: ${details}`,
      );

      // Keep the stack trace available for development diagnostics.
      if (error instanceof Error && error.stack) {
        this.logger.debug(error.stack);
      }

      // Do not allow the application to start without a verified database.
      throw error;
    }
  }

  /**
   * Closes Prisma's database connections during application shutdown.
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing PostgreSQL connection...');

    try {
      await this.$disconnect();
      this.logger.log('PostgreSQL connection closed successfully.');
    } catch (error: unknown) {
      const details =
        error instanceof Error
          ? error.message
          : 'An unknown disconnection error occurred.';

      this.logger.error(
        `Failed to close PostgreSQL connection: ${details}`,
      );

      // Do not silently hide a failed cleanup operation.
      throw error;
    }
  }
}