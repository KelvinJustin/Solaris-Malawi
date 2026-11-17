/**
 * create-admin.ts — Admin Provisioning Script
 *
 * Creates a new admin account directly in the database.
 * No public registration endpoint exists by design.
 *
 * Usage:
 *   npx tsx ./src/scripts/create-admin.ts \
 *     --name "John Doe" \
 *     --email "john@solaris.mw" \
 *     --password "supersecret123" \
 *     --role COMPLIANCE
 *
 * Roles:
 *   SUPER_ADMIN  — full platform access
 *   COMPLIANCE   — KYC review and document approval
 *   OPERATIONS   — day-to-day platform operations
 *   SUPPORT      — read-only merchant support (default)
 *
 * Run --help for all options:
 *   npx tsx ./src/scripts/create-admin.ts --help
 */

import { NestFactory } from '@nestjs/core';
import type { LoggerService } from '@nestjs/common';
import { Command, Option } from 'commander';
import dotenv from 'dotenv';

import bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service.js';
import { AdminRole, AdminStatus } from '../generated/prisma/client.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module.js';
import {
    createFileLogger,
    flushFileLogger,
} from '../logging/file-logger.js';

// ============================================================
// CLI
// ============================================================

dotenv.config();

const program = new Command()
    .name('create-admin')
    .description('Provision a new Solaris admin account')
    .requiredOption('-n, --name <name>', 'Full name')
    .requiredOption('-e, --email <email>', 'Email address')
    .requiredOption('-p, --password <password>', 'Password (min 12 characters)')
    .addOption(
        new Option('-r, --role <role>', 'Admin role')
            .choices(Object.values(AdminRole))
            .default(AdminRole.SUPPORT),
    )
    .parse();

const opts = program.opts<{
    name: string;
    email: string;
    password: string;
    role: AdminRole;
}>();

const logger = createFileLogger('admin-provisioning');

const nestLogger: LoggerService = {
    log(message: any, ...optionalParams: any[]) {
        logger.info({ context: optionalParams.at(-1) }, message);
    },
    error(message: any, ...optionalParams: any[]) {
        logger.error(
            {
                context: optionalParams.at(-1),
                trace: optionalParams.length > 1 ? optionalParams[0] : undefined,
            },
            message,
        );
    },
    warn(message: any, ...optionalParams: any[]) {
        logger.warn({ context: optionalParams.at(-1) }, message);
    },
    debug(message: any, ...optionalParams: any[]) {
        logger.debug({ context: optionalParams.at(-1) }, message);
    },
    verbose(message: any, ...optionalParams: any[]) {
        logger.trace({ context: optionalParams.at(-1) }, message);
    },
    fatal(message: any, ...optionalParams: any[]) {
        logger.fatal({ context: optionalParams.at(-1) }, message);
    },
};

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        DatabaseModule,
    ],
})
class AdminProvisioningModule {}

async function createAdmin() {
    if (opts.password.length < 12) {
        throw new Error('Password must be at least 12 characters.');
    }

    // Boot only the application context — no HTTP server needed.
    const app = await NestFactory.createApplicationContext(
        AdminProvisioningModule,
        { logger: nestLogger },
    );

    try {
        const db = app.get(DatabaseService);
        const email = opts.email.trim().toLowerCase();

        const existing = await db.admin.findUnique({ where: { email } });
        if (existing) {
            throw new Error(`An admin with email ${email} already exists.`);
        }

        const admin = await db.admin.create({
            data: {
                name: opts.name.trim(),
                email,
                passwordHash: await bcrypt.hash(opts.password, 12),
                role: opts.role,
                status: AdminStatus.ACTIVE,
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
                createdAt: true,
            },
        });

        logger.info(
            { adminId: admin.id, role: admin.role },
            'Admin created successfully',
        );
    } finally {
        await app.close();
    }
}

createAdmin()
    .then(() => flushFileLogger(logger))
    .catch(async (error: unknown) => {
        logger.error({ err: error }, 'Admin provisioning failed');
        await flushFileLogger(logger);
        process.exitCode = 1;
    });