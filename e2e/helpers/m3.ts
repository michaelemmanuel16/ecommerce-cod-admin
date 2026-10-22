import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * M3-T70: shared helpers for the m3-*.spec.ts files. They run against the dev stack (frontend 5174, backend 3001),
 * never production. Everything a spec creates carries the first name "E2E" and a unique phone, so it can be found.
 */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5174';
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
export const PASSWORD = 'password123';
export const OWNER_EMAIL = 'admin@codadmin.com';
export const NO_ACCESS = 'You do not have access to this page';

export type Role = 'accountant' | 'inventory_manager' | 'sales_rep' | 'delivery_agent';

/** Dev users that already exist on the dev stack. A read-only spec reuses them instead of creating new ones. */
const DEV_EMAIL: Record<Role, string> = {
  accountant: 'e2e-finance@codadmin.com',
  inventory_manager: 'e2e-stock@codadmin.com',
  sales_rep: 'e2e-rep@codadmin.com',
  delivery_agent: 'e2e-agent@codadmin.com',
};

export const stamp = (): string => String(Date.now());

let seq = 0;
/** A Ghana mobile number no earlier run has used: 024 plus seven digits that change on every call. */
export const uniquePhone = (): string => `024${String((Date.now() + 7919 * ++seq) % 10_000_000).padStart(7, '0')}`;

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Logs in through the API and returns the access token, or null when the sign-in is refused. */
export async function tokenFor(request: APIRequestContext, email: string): Promise<string | null> {
  const res = await request.post(`${API_URL}/api/auth/login`, { data: { email, password: PASSWORD } });
  if (!res.ok()) return null;
  return (await res.json()).tokens.accessToken as string;
}

export async function ownerToken(request: APIRequestContext): Promise<string> {
  const token = await tokenFor(request, OWNER_EMAIL);
  expect(token, `the owner ${OWNER_EMAIL} must be able to sign in on ${API_URL}`).not.toBeNull();
  return token!;
}

export interface TestUser { id: number; email: string; role: Role; firstName: string; lastName: string; name: string }

/** Creates a user with the owner token: `E2E <Role><timestamp>`, e2e-<role>-<timestamp>@codadmin.test. */
export async function createUser(request: APIRequestContext, owner: string, role: Role): Promise<TestUser> {
  const ts = stamp();
  const label = role.replace(/_/g, '');
  const body = {
    email: `e2e-${label}-${ts}@codadmin.test`,
    password: PASSWORD,
    firstName: 'E2E',
    lastName: `${label}${ts}`,
    phoneNumber: uniquePhone(),
    role,
  };
  const res = await request.post(`${API_URL}/api/users`, { data: body, headers: auth(owner) });
  expect(res.status(), `create ${role}: ${await res.text()}`).toBe(201);
  const { user } = await res.json();
  return { id: user.id, email: body.email, role, firstName: body.firstName, lastName: body.lastName, name: `${body.firstName} ${body.lastName}` };
}

/** The dev user for the role when it can sign in, otherwise a new one. Used by the read-only specs. */
export async function userFor(request: APIRequestContext, owner: string, role: Role): Promise<{ email: string }> {
  if (await tokenFor(request, DEV_EMAIL[role])) return { email: DEV_EMAIL[role] };
  return createUser(request, owner, role);
}

export interface TestProduct { id: number; name: string }

export async function createProduct(request: APIRequestContext, owner: string): Promise<TestProduct> {
  const ts = stamp();
  const res = await request.post(`${API_URL}/api/products`, {
    data: { sku: `E2E-${ts}`, name: `E2E Product ${ts}`, category: 'e2e', price: 249, cogs: 80, stockQuantity: 100 },
    headers: auth(owner),
  });
  expect(res.status(), `create product: ${await res.text()}`).toBe(201);
  const { product } = await res.json();
  return { id: product.id, name: product.name };
}

/** An order made through the API for a new customer `E2E <lastName>`. `repId` assigns the call rep. */
export async function createOrder(
  request: APIRequestContext,
  owner: string,
  product: TestProduct,
  lastName: string,
  repId?: number,
): Promise<{ id: number; phone: string }> {
  const phone = uniquePhone();
  const res = await request.post(`${API_URL}/api/orders`, {
    data: {
      customerName: `E2E ${lastName}`,
      customerPhone: phone,
      deliveryAddress: '1 E2E Street',
      deliveryState: 'Greater Accra',
      deliveryArea: 'Accra',
      orderItems: [{ productId: product.id, quantity: 1, unitPrice: 249 }],
      subtotal: 249,
      discount: 0,
      totalAmount: 249,
      customerConfirmed: false,
      ...(repId ? { customerRepId: repId } : {}),
    },
    headers: auth(owner),
  });
  expect(res.status(), `create order: ${await res.text()}`).toBe(201);
  const { order } = await res.json();
  return { id: order.id, phone };
}

/** The orders the token's user can list (GET /api/orders). */
export async function listOrders(request: APIRequestContext, token: string): Promise<Array<{ id: number; customerRep?: { id: number } | null }>> {
  const res = await request.get(`${API_URL}/api/orders?limit=100`, { headers: auth(token) });
  expect(res.status(), `list orders: ${await res.text()}`).toBe(200);
  return (await res.json()).orders;
}
