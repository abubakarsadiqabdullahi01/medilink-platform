import { describe, expect, it } from 'vitest';
import { parseAfricasTalkingReceipt } from './receipts';

/**
 * Africa's Talking's delivery report, as a form-encoded callback: `id` (the message id its
 * send answer carried), `status`, `phoneNumber`, `networkCode`, `failureReason`, `retryCount`.
 * Written from what the provider documents and not seen from the provider; the one thing these
 * cases can establish is that a report this code cannot read changes nothing.
 */
describe("reading an Africa's Talking delivery report", () => {
  const report = (fields: Record<string, string>) => ({
    id: 'ATXid_123',
    phoneNumber: '+2348031234567',
    networkCode: '62120',
    retryCount: '0',
    ...fields,
  });

  it.each([
    ['Success', 'DELIVERED'],
    ['Sent', 'PENDING'],
    ['Submitted', 'PENDING'],
    ['Buffered', 'PENDING'],
    ['Failed', 'FAILED'],
    ['Rejected', 'FAILED'],
  ])('reads status %s as %s', (status, outcome) => {
    expect(parseAfricasTalkingReceipt(report({ status }))).toMatchObject({
      provider: 'africastalking',
      providerMessageId: 'ATXid_123',
      outcome,
    });
  });

  it('keeps the reason a message failed, which is a code and not a person', () => {
    const parsed = parseAfricasTalkingReceipt(report({ status: 'Failed', failureReason: 'InsufficientCredit' }));

    expect(parsed?.detail).toBe('InsufficientCredit');
  });

  it('never carries the phone number or the network onward', () => {
    const parsed = parseAfricasTalkingReceipt(report({ status: 'Success' }));

    expect(JSON.stringify(parsed)).not.toContain('2348031234567');
    expect(JSON.stringify(parsed)).not.toContain('62120');
  });

  it('is read whatever the case of the status', () => {
    expect(parseAfricasTalkingReceipt(report({ status: 'success' }))?.outcome).toBe('DELIVERED');
  });

  it.each([
    ['a status it does not know', report({ status: 'Teleported' })],
    ['no status', { id: 'ATXid_123' }],
    ['no message id', { status: 'Success' }],
    ['an empty message id', report({ id: '  ', status: 'Success' })],
    ['nothing at all', {}],
  ])('reads nothing from %s, rather than guessing', (_label, fields) => {
    expect(parseAfricasTalkingReceipt(fields)).toBeNull();
  });

  it('keeps a reason short enough to store', () => {
    const parsed = parseAfricasTalkingReceipt(report({ status: 'Failed', failureReason: 'x'.repeat(500) }));

    expect(parsed!.detail!.length).toBeLessThanOrEqual(100);
  });
});
