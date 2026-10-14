import { describe, expect, it, vi } from 'vitest';
import { africasTalkingAdapter } from './africastalking';
import { SmsProviderError, termiiAdapter } from './termii';

const reply = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));

const termii = { apiKey: 'TLsecretkey', senderId: 'Medilink' };
const at = { apiKey: 'ATsecretkey', username: 'medilink' };

describe('the Termii adapter', () => {
  it('posts the documented request: the number without its plus, the sender, the key in the body', async () => {
    const fetchImpl = reply({ code: 'ok', message_id: 'm-1', message: 'Successfully Sent' });

    await termiiAdapter(termii, fetchImpl).send({ to: '+2348031234567', body: 'Your code is 123456.' });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.ng.termii.com/api/sms/send');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      to: '2348031234567',
      from: 'Medilink',
      sms: 'Your code is 123456.',
      type: 'plain',
      channel: 'generic',
      api_key: 'TLsecretkey',
    });
  });

  it('sends a one-time code on the do-not-disturb channel, so a filtered code is not a locked-out person', async () => {
    const fetchImpl = reply({ code: 'ok', message_id: 'm-1' });

    await termiiAdapter(termii, fetchImpl).send({ to: '+2348031234567', body: 'x', transactional: true });

    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body).channel).toBe('dnd');
  });

  it('reports a message the provider took as accepted, with its id', async () => {
    const result = await termiiAdapter(termii, reply({ code: 'ok', message_id: 'm-9' })).send({ to: '+2348031234567', body: 'x' });

    expect(result).toEqual({ provider: 'termii', providerMessageId: 'm-9', accepted: true });
  });

  it('reports one it answered without taking as not accepted, rather than as sent', async () => {
    const result = await termiiAdapter(termii, reply({ code: 'insufficient_balance', message: 'No balance' })).send({ to: '+2348031234567', body: 'x' });

    expect(result.accepted).toBe(false);
  });

  it('fails on an error status, and on an answer it cannot read, never counting either as sent', async () => {
    await expect(termiiAdapter(termii, reply({ message: 'Invalid key' }, 401)).send({ to: '+2348031234567', body: 'x' })).rejects.toBeInstanceOf(SmsProviderError);
    await expect(termiiAdapter(termii, reply('<html>gateway timeout</html>')).send({ to: '+2348031234567', body: 'x' })).rejects.toBeInstanceOf(SmsProviderError);
  });

  it('puts neither the key nor the message in what it throws', async () => {
    const error = await termiiAdapter(termii, reply({}, 500)).send({ to: '+2348031234567', body: 'Your code is 987654.' }).catch((caught: Error) => caught);

    expect(String((error as Error).message)).not.toContain('TLsecretkey');
    expect(String((error as Error).message)).not.toContain('987654');
  });
});

describe('the Africa\'s Talking adapter', () => {
  it('posts the documented request: form-encoded, the key in a header, the number with its plus', async () => {
    const fetchImpl = reply({ SMSMessageData: { Recipients: [{ statusCode: 101, messageId: 'ATXid_1' }] } });

    await africasTalkingAdapter({ ...at, senderId: 'MEDILINK' }, fetchImpl).send({ to: '+2348031234567', body: 'Your code is 123456.' });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.africastalking.com/version1/messaging');
    expect(init.headers.apiKey).toBe('ATsecretkey');
    const form = new URLSearchParams(init.body);
    expect(Object.fromEntries(form)).toEqual({
      username: 'medilink',
      to: '+2348031234567',
      message: 'Your code is 123456.',
      from: 'MEDILINK',
    });
  });

  it('uses the sandbox host for the sandbox account', async () => {
    const fetchImpl = reply({ SMSMessageData: { Recipients: [{ statusCode: 101 }] } });

    await africasTalkingAdapter({ apiKey: 'k', username: 'sandbox' }, fetchImpl).send({ to: '+2348031234567', body: 'x' });

    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.sandbox.africastalking.com/version1/messaging');
  });

  it.each([100, 101, 102])('counts status %i as taken', async (statusCode) => {
    const result = await africasTalkingAdapter(at, reply({ SMSMessageData: { Recipients: [{ statusCode, messageId: 'a' }] } })).send({ to: '+2348031234567', body: 'x' });

    expect(result).toEqual({ provider: 'africastalking', providerMessageId: 'a', accepted: true });
  });

  it.each([401, 403, 404, 500])('does not count status %i as taken', async (statusCode) => {
    const result = await africasTalkingAdapter(at, reply({ SMSMessageData: { Recipients: [{ statusCode }] } })).send({ to: '+2348031234567', body: 'x' });

    expect(result.accepted).toBe(false);
  });

  it('does not count an answer with no recipient as taken', async () => {
    const result = await africasTalkingAdapter(at, reply({ SMSMessageData: { Message: 'Invalid sender', Recipients: [] } })).send({ to: '+2348031234567', body: 'x' });

    expect(result.accepted).toBe(false);
  });

  it('fails on an error status or an unreadable answer', async () => {
    await expect(africasTalkingAdapter(at, reply('Unauthorized', 401)).send({ to: '+2348031234567', body: 'x' })).rejects.toBeInstanceOf(SmsProviderError);
  });
});
