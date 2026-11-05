import { BusinessType, DocumentType } from '../generated/prisma/enums.js';

/**
  Defines the document policy for one type of merchant.

  required: Documents that must be approved before the application
           can be approved.

  optional: Documents the merchant may provide, but does not have
           to provide under the initial development policy.
 */
export interface DocumentRequirements {
    required: DocumentType[];
    optional: DocumentType[];
}

/**
 Initial document policy.
 
  These are development defaults, not a definitive statement
*/
const DOCUMENT_REQUIREMENTS: Record<BusinessType, DocumentRequirements> = {
    [BusinessType.INDIVIDUAL]: {
        required: [DocumentType.NATIONAL_ID_FRONT, DocumentType.NATIONAL_ID_BACK],
        optional: [DocumentType.TAX_CERTIFICATE, DocumentType.PROOF_OF_ADDRESS],
    },

    [BusinessType.SOLE_TRADER]: {
        required: [DocumentType.NATIONAL_ID_FRONT, DocumentType.NATIONAL_ID_BACK],
        optional: [
            DocumentType.BUSINESS_REGISTRATION,
            DocumentType.TAX_CERTIFICATE,
            DocumentType.PROOF_OF_ADDRESS,
        ],
    },

    [BusinessType.PARTNERSHIP]: {
        required: [
            DocumentType.NATIONAL_ID_FRONT,
            DocumentType.NATIONAL_ID_BACK,
            DocumentType.BUSINESS_REGISTRATION,
        ],
        optional: [
            DocumentType.TAX_CERTIFICATE,
            DocumentType.PROOF_OF_ADDRESS,
            DocumentType.DIRECTOR_ID,
        ],
    },

    [BusinessType.LIMITED_COMPANY]: {
        required: [
            DocumentType.NATIONAL_ID_FRONT,
            DocumentType.NATIONAL_ID_BACK,
            DocumentType.BUSINESS_REGISTRATION,
            DocumentType.TAX_CERTIFICATE,
            DocumentType.DIRECTOR_ID,
        ],
        optional: [DocumentType.PROOF_OF_ADDRESS],
    },

    [BusinessType.NGO]: {
        required: [
            DocumentType.NATIONAL_ID_FRONT,
            DocumentType.NATIONAL_ID_BACK,
            DocumentType.BUSINESS_REGISTRATION,
            DocumentType.DIRECTOR_ID,
        ],
        optional: [DocumentType.TAX_CERTIFICATE, DocumentType.PROOF_OF_ADDRESS],
    },
};

/**
 Returns the document requirements for a business type.

 We return copies of the arrays so callers cannot accidentally
 modify the policy stored in DOCUMENT_REQUIREMENTS.
 */
export function getDocumentRequirements(
    businessType: BusinessType,
): DocumentRequirements {
    const requirements = DOCUMENT_REQUIREMENTS[businessType];

    return {
        required: [...requirements.required],
        optional: [...requirements.optional],
    };
}
