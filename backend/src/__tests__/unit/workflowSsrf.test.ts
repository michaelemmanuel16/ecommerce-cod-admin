/**
 * M9-T48 (COD-85): the workflow webhook action (`http_request`) refuses private, loopback and link-local hosts.
 * safeHttp.test.ts covers the guard itself with a fake lookup and transport. This runs the real action
 * (runHttpRequestAction, and executeAction as the worker calls it) with the real guard. Every host here is an
 * IP literal or `localhost`, so a refusal happens before any socket opens and no network is needed.
 */
import { describe, it, expect, jest } from '@jest/globals';
import '../mocks/logger.mock';
import { runHttpRequestAction } from '../../services/workflowActions';
import { executeAction } from '../../queues/workflowQueue';
import { runInTenant } from '../../utils/tenantContext';

jest.mock('../../utils/socketInstance', () => ({ getSocketInstance: jest.fn(() => null) }));

const BLOCKED: Array<[string, string]> = [
  ['loopback', 'http://127.0.0.1/hook'],
  ['loopback with a port', 'http://127.0.0.1:3000/api/auth/login'],
  ['localhost', 'http://localhost/hook'],
  ['IPv6 loopback', 'http://[::1]/hook'],
  ['private 10/8', 'http://10.0.0.5/hook'],
  ['private 172.16/12', 'http://172.16.4.1/hook'],
  ['private 192.168/16', 'http://192.168.1.10/hook'],
  ['link-local cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
  ['IPv6 link-local', 'http://[fe80::1]/hook'],
  ['IPv6 unique local', 'http://[fd00::1]/hook'],
  ['IPv4 mapped in IPv6 loopback', 'http://[::ffff:127.0.0.1]/hook'],
  ['0.0.0.0', 'http://0.0.0.0/hook'],
];

describe('workflow http_request refuses internal hosts', () => {
  it.each(BLOCKED)('%s (editor shape: config.url)', async (_label, url) => {
    await expect(runHttpRequestAction({ type: 'http_request', config: { url, method: 'POST', body: '{}' } })).rejects.toThrow();
  });

  it('refuses the older flat shape (action.url) too', async () => {
    await expect(runHttpRequestAction({ type: 'http_request', url: 'http://169.254.169.254/' })).rejects.toThrow();
  });

  it('the worker path (executeAction) refuses it and the error does not echo the headers', async () => {
    const action = { type: 'http_request', config: { url: 'http://10.1.2.3/hook', headers: { Authorization: 'Bearer secret-token-xyz' } } };
    const err = await runInTenant('tenant-a', () => executeAction(action, {})).then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err!.message)).not.toContain('secret-token-xyz');
  });

  it('refuses a scheme that is not http or https', async () => {
    await expect(runHttpRequestAction({ config: { url: 'file:///etc/passwd' } })).rejects.toThrow();
    await expect(runHttpRequestAction({ config: { url: 'gopher://127.0.0.1/' } })).rejects.toThrow();
  });
});
