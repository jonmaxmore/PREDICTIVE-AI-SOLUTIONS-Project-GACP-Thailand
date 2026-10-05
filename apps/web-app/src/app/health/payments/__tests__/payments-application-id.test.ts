import { resolvePaymentsApplicationId } from '../payments-application-id';

describe('which application the payments page gates on', () => {
    test('the URL always wins — a link from the submit hand-over is explicit', () => {
        expect(resolvePaymentsApplicationId({
            appFilter: 'app-url',
            payments: [{ applicationId: 'app-invoice' }],
            applications: [{ id: 'app-list', status: 'PENDING_DOC_FEE' }],
        })).toBe('app-url');
    });

    test('an invoice row wins over the list — money already billed comes first', () => {
        expect(resolvePaymentsApplicationId({
            appFilter: '',
            payments: [{ applicationId: 'app-invoice' }],
            applications: [{ id: 'app-list', status: 'PENDING_DOC_FEE' }],
        })).toBe('app-invoice');
    });

    test('no invoices and no URL: the payable filing from the applicant\'s own list', () => {
        // The walked dead end: quotation pending, zero invoices, farmer arrived via the
        // nav menu. The page must find the filing itself.
        expect(resolvePaymentsApplicationId({
            appFilter: '',
            payments: [],
            applications: [
                { id: 'app-draft', status: 'DRAFT' },
                { id: 'app-payable', status: 'PENDING_DOC_FEE' },
            ],
        })).toBe('app-payable');
    });

    test('a DRAFT is never picked — nothing is due on an unfiled application', () => {
        expect(resolvePaymentsApplicationId({
            appFilter: '', payments: [], applications: [{ id: 'app-draft', status: 'DRAFT' }],
        })).toBe('');
    });

    test('nothing anywhere is an empty answer, not a crash', () => {
        expect(resolvePaymentsApplicationId({ appFilter: '', payments: [], applications: [] })).toBe('');
    });
});
