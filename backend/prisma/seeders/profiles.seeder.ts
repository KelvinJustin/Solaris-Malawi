
import {
  AccountStatus,
  BusinessType,
  DocumentStatus,
  DocumentType,
  ProfileActorType,
} from "../../src/generated/prisma/enums.js";
import {
  createFileLogger,
  flushFileLogger,
} from "../../src/logging/file-logger.js";

import {
  prisma,
  disconnectSeedClient,
} from "./seed-client.js";

const logger = createFileLogger("profile-seeder");

const fixtures = [
  {
    email: "seed.soletrader@solaris.local",
    businessName: "Development Sole Trader",
    businessType: BusinessType.SOLE_TRADER,
    status: AccountStatus.SUBMITTED,
    documents: [
      DocumentType.NATIONAL_ID_FRONT,
      DocumentType.NATIONAL_ID_BACK,
      DocumentType.PROOF_OF_ADDRESS,
    ],
  },
  {
    email: "seed.company@solaris.local",
    businessName: "Development Limited Company",
    businessType: BusinessType.LIMITED_COMPANY,
    status: AccountStatus.UNDER_REVIEW,
    documents: [
      DocumentType.BUSINESS_REGISTRATION,
      DocumentType.TAX_CERTIFICATE,
      DocumentType.DIRECTOR_ID,
    ],
  },
  {
    email: "seed.pending@solaris.local",
    businessName: "Development Pending Merchant",
    businessType: BusinessType.SOLE_TRADER,
    status: AccountStatus.REJECTED,
    documents: [
      DocumentType.NATIONAL_ID_FRONT,
      DocumentType.NATIONAL_ID_BACK,
      DocumentType.PROOF_OF_ADDRESS,
    ],
  },
  {
    email: "seed.approved@solaris.local",
    businessName: "Development Approved Merchant",
    businessType: BusinessType.SOLE_TRADER,
    status: AccountStatus.APPROVED,
    documents: [],
  },
];

async function main(): Promise<void> {
  logger.info("[PROFILE SEED] Seeder loaded.");
  logger.info({ fixtureCount: fixtures.length }, "[PROFILE SEED] Fixtures loaded");
  logger.info("[PROFILE SEED] Starting...");

  for (const fixture of fixtures) {
    const merchant = await prisma.merchant.findUnique({
      where: { email: fixture.email },
    });

    if (!merchant) {
      throw new Error(
        `Merchant ${fixture.email} not found. Run seed:merchants first.`,
      );
    }

    const profile = await prisma.merchantProfile.upsert({
      where: { merchantId: merchant.id },
      update: {
        businessName: fixture.businessName,
        businessType: fixture.businessType,
        accountStatus: fixture.status,
        submittedAt: new Date(),
        rejectionReason:
          fixture.status === AccountStatus.REJECTED
            ? "Development fixture: additional information required."
            : null,
      },
      create: {
        merchantId: merchant.id,
        businessName: fixture.businessName,
        businessType: fixture.businessType,
        accountStatus: fixture.status,
        submittedAt: new Date(),
        rejectionReason:
          fixture.status === AccountStatus.REJECTED
            ? "Development fixture: additional information required."
            : null,
      },
    });

    logger.info(
      { profileId: profile.id, status: fixture.status },
      "[PROFILE SEED] Profile ready",
    );

    for (const type of fixture.documents) {
      const existingDocument = await prisma.merchantDocument.findFirst({
        where: {
          profileId: profile.id,
          type,
          supersededAt: null,
        },
      });

      const isRejected =
        fixture.status === AccountStatus.REJECTED &&
        type === DocumentType.NATIONAL_ID_FRONT;
      const documentData = {
        status: isRejected ? DocumentStatus.REJECTED : DocumentStatus.PENDING,
        fileUrl: `dev-fixture://${profile.id}/${type}`,
        fileKey: `dev-fixtures/${profile.id}/${type}`,
        mimeType: "application/pdf",
        fileSizeBytes: 1024,
        rejectionNote: isRejected
          ? "Development fixture: sample document rejected."
          : null,
      };

      if (existingDocument) {
        await prisma.merchantDocument.update({
          where: { id: existingDocument.id },
          data: documentData,
        });
      } else {
        await prisma.merchantDocument.create({
          data: {
            profileId: profile.id,
            type,
            ...documentData,
          },
        });
      }

      logger.info({ documentType: type }, "[PROFILE SEED] Document ready");
    }

    // Rebuild review history for these development fixtures.
    await prisma.merchantReviewHistory.deleteMany({
      where: { profileId: profile.id },
    });

    const previousStatus =
      fixture.status === AccountStatus.SUBMITTED
        ? AccountStatus.PENDING_SUBMISSION
        : fixture.status === AccountStatus.UNDER_REVIEW
          ? AccountStatus.SUBMITTED
          : AccountStatus.UNDER_REVIEW;

    await prisma.merchantReviewHistory.create({
      data: {
        profileId: profile.id,
        fromStatus: previousStatus,
        toStatus: fixture.status,
        note: "Development seed fixture; not a genuine compliance decision.",
        actorType:
          fixture.status === AccountStatus.SUBMITTED
            ? ProfileActorType.MERCHANT
            : ProfileActorType.ADMIN,
        actorId:
          fixture.status === AccountStatus.SUBMITTED
            ? merchant.id
            : null,
      },
    });

    logger.info(
      { profileId: profile.id },
      "[PROFILE SEED] Review history ready",
    );
  }

  logger.info("[PROFILE SEED] SUCCESS — all profile fixtures seeded.");
}

logger.info("[PROFILE SEED] Loading seeder...");

try {
  await main();
} catch (error) {
  logger.error({ err: error }, "[PROFILE SEED] FAILED");
  process.exitCode = 1;
} finally {
  logger.info("[PROFILE SEED] Disconnecting from database...");
  await disconnectSeedClient();
  logger.info("[PROFILE SEED] Seeder finished.");
    await flushFileLogger(logger);
}
