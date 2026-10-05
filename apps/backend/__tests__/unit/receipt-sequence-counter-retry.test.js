'use strict';
const { allocateSequenceCounter } = require('../../services/receipt-sequence-counter');

const conflict = (code) => Object.assign(new Error('conflict'), { code });
function bareClient(failures, code) {
    let calls = 0;
    const tx = { receiptSequence: { upsert: jest.fn(async () => ({ counter: 5 })) } };
    return {
        client: {
            receiptSequence: { upsert: jest.fn() },
            $transaction: jest.fn(async (fn) => { calls += 1; if (calls <= failures) { throw conflict(code); } return fn(tx); }),
        },
        calls: () => calls,
    };
}

describe('allocateSequenceCounter bare-client retry', () => {
    test.each(['P2034', 'P2002'])('retries %s then succeeds', async (code) => {
        const { client, calls } = bareClient(2, code);
        await expect(allocateSequenceCounter(client, 'TH-GACP', 2569)).resolves.toBe(5);
        expect(calls()).toBe(3);
    });
    test('gives up after 3 attempts and throws the conflict', async () => {
        const { client, calls } = bareClient(9, 'P2034');
        await expect(allocateSequenceCounter(client, 'TH-GACP', 2569)).rejects.toMatchObject({ code: 'P2034' });
        expect(calls()).toBe(3);
    });
    test('other errors are not retried', async () => {
        const { client, calls } = bareClient(9, 'P1001');
        await expect(allocateSequenceCounter(client, 'TH-GACP', 2569)).rejects.toMatchObject({ code: 'P1001' });
        expect(calls()).toBe(1);
    });
    test('inside a caller tx the conflict propagates at once', async () => {
        const tx = { receiptSequence: { upsert: jest.fn(async () => { throw conflict('P2034'); }) } };
        await expect(allocateSequenceCounter(tx, 'TH-GACP', 2569)).rejects.toMatchObject({ code: 'P2034' });
        expect(tx.receiptSequence.upsert).toHaveBeenCalledTimes(1);
    });
});
