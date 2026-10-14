// Route table for billing and settlement.
import type { Permission } from '@/lib/authz/permissions';
import type { ScopeType } from '@/lib/authz/guard';

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  permission: Permission;
  scopeType: ScopeType;
}

/**
 * Raising and issuing an invoice is `payout.manage` at PLATFORM, not the
 * facility's own act: a facility that could issue its own invoices could
 * decide what it owes. It reads them at FACILITY scope and pays them there.
 */
export const ROUTES: RouteDefinition[] = [
  { method: 'POST', path: '/api/v1/invoices', permission: 'payout.manage', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/invoices', permission: 'invoice.read', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/dashboard/finance', permission: 'invoice.read', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/finance/invoices', permission: 'invoice.read', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/invoices/:id/issue', permission: 'payout.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/invoices/:id/void', permission: 'payout.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/invoices/:id/pay', permission: 'payout.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/payouts', permission: 'payout.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/payouts/:id/release', permission: 'payout.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/payouts/:id/settle', permission: 'payout.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/payouts/:id/fail', permission: 'payout.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/payouts/:id/cancel', permission: 'payout.manage', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/payouts', permission: 'invoice.read', scopeType: 'SELF' },
];
