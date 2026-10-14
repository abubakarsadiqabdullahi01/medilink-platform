import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ CLIENT_IP_HEADER: undefined as string | undefined }));
vi.mock('../env', () => ({ env }));

import { requestContextFrom } from './request-context';

const request = (headers: Record<string, string>) => new Request('http://localhost/x', { headers });

beforeEach(() => {
  env.CLIENT_IP_HEADER = undefined;
});

describe('the address a request came from', () => {
  it('is the first entry of X-Forwarded-For when nothing says which header the edge sets', () => {
    expect(requestContextFrom(request({ 'x-forwarded-for': '102.89.1.1, 10.0.0.2' })).ipAddress).toBe('102.89.1.1');
  });

  it('is the header the deployment names, which is the one its edge overwrites', () => {
    env.CLIENT_IP_HEADER = 'Fly-Client-IP';

    const context = requestContextFrom(request({ 'fly-client-ip': '102.89.1.1', 'x-forwarded-for': '1.2.3.4' }));

    expect(context.ipAddress).toBe('102.89.1.1');
  });

  it('does not fall back to the spoofable header when the named one is missing', () => {
    // A caller who reaches the app without passing the edge, or who sets X-Forwarded-For
    // themselves, would otherwise choose their own address and with it their own rate limit.
    env.CLIENT_IP_HEADER = 'fly-client-ip';

    expect(requestContextFrom(request({ 'x-forwarded-for': '1.2.3.4' })).ipAddress).toBeUndefined();
  });

  it('reads X-Forwarded-For when the deployer has said, with none, that the edge replaces it', () => {
    env.CLIENT_IP_HEADER = 'none';

    expect(requestContextFrom(request({ 'x-forwarded-for': '102.89.1.1' })).ipAddress).toBe('102.89.1.1');
  });

  it('takes the first entry of a named header that lists several', () => {
    env.CLIENT_IP_HEADER = 'x-real-ip';

    expect(requestContextFrom(request({ 'x-real-ip': '102.89.1.1, 10.0.0.2' })).ipAddress).toBe('102.89.1.1');
  });
});
