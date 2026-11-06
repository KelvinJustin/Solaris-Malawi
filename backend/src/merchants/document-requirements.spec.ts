import { describe, expect, it } from 'vitest';

import {
    BusinessType,
    DocumentType,
} from '../generated/prisma/enums.js';

import {
    getDocumentRequirements,
} from './document-requirements.js';

// Group all test cases for the getDocumentRequirements function.
describe('getDocumentRequirements', () => {
    // Verify that individual business types require only national identification documents.
    it('requires only national ID documents for an individual', () => {
        // Retrieve the document requirements for an individual merchant.
        const result = getDocumentRequirements(BusinessType.INDIVIDUAL);

        // Ensure that only the front and back of the national ID are marked as mandatory.
        expect(result.required).toEqual([
            DocumentType.NATIONAL_ID_FRONT,
            DocumentType.NATIONAL_ID_BACK,
        ]);

        // Ensure that tax certificates and proof of address are listed as optional.
        expect(result.optional).toEqual([
            DocumentType.TAX_CERTIFICATE,
            DocumentType.PROOF_OF_ADDRESS,
        ]);
    });

    // Verify that sole traders are not forced to provide official business registration.
    it('allows a sole trader to onboard without business registration', () => {
        // Retrieve requirements for a sole trader.
        const result = getDocumentRequirements(BusinessType.SOLE_TRADER);

        // Ensure the required documents only include national ID components.
        expect(result.required).toEqual([
            DocumentType.NATIONAL_ID_FRONT,
            DocumentType.NATIONAL_ID_BACK,
        ]);

        // Check that business registration is included among the optional documents.
        expect(result.optional).toContain(
            DocumentType.BUSINESS_REGISTRATION,
        );
    });

    // Verify that partnerships must submit business registration documents.
    it('requires business registration for a partnership', () => {
        // Retrieve requirements for a partnership entity.
        const result = getDocumentRequirements(BusinessType.PARTNERSHIP);

        // Ensure business registration is mandatory.
        expect(result.required).toContain(
            DocumentType.BUSINESS_REGISTRATION,
        );

        // Ensure director identification is available as an optional document.
        expect(result.optional).toContain(
            DocumentType.DIRECTOR_ID,
        );
    });

    // Verify comprehensive requirements for a limited company structure.
    it('requires the configured documents for a limited company', () => {
        // Retrieve document requirements for a limited company.
        const result = getDocumentRequirements(
            BusinessType.LIMITED_COMPANY,
        );

        // Confirm all mandatory documents for a corporate entity are present.
        expect(result.required).toEqual([
            DocumentType.NATIONAL_ID_FRONT,
            DocumentType.NATIONAL_ID_BACK,
            DocumentType.BUSINESS_REGISTRATION,
            DocumentType.TAX_CERTIFICATE,
            DocumentType.DIRECTOR_ID,
        ]);

        // Ensure proof of address is treated as optional.
        expect(result.optional).toContain(
            DocumentType.PROOF_OF_ADDRESS,
        );
    });

    // Verify that NGOs have specific exemptions from certain standard requirements.
    it('does not require a tax certificate or proof of address for an NGO', () => {
        // Retrieve requirements for a non-governmental organization.
        const result = getDocumentRequirements(BusinessType.NGO);

        // Ensure tax certificates are not in the required list.
        expect(result.required).not.toContain(
            DocumentType.TAX_CERTIFICATE,
        );

        // Ensure proof of address is not required.
        expect(result.required).not.toContain(
            DocumentType.PROOF_OF_ADDRESS,
        );

        // Ensure business registration remains mandatory for NGOs.
        expect(result.required).toContain(
            DocumentType.BUSINESS_REGISTRATION,
        );
    });

    // Verify that requirement objects are cloned to prevent external mutations from corrupting global state.
    it('returns independent arrays so callers cannot mutate the policy', () => {
        // Fetch the initial requirements object.
        const first = getDocumentRequirements(BusinessType.INDIVIDUAL);

        // Attempt to mutate the returned array by removing an element.
        first.required.pop();

        // Fetch a fresh copy of the requirements for the same business type.
        const second = getDocumentRequirements(BusinessType.INDIVIDUAL);

        // Confirm that the second call is unaffected by the mutation on the first.
        expect(second.required).toEqual([
            DocumentType.NATIONAL_ID_FRONT,
            DocumentType.NATIONAL_ID_BACK,
        ]);
    });
});