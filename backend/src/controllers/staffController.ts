import { AuthRequest } from '../types';
import { auditService } from '../services/auditService';
import * as staffService from '../services/staffService';
import * as inviteService from '../services/inviteService';
import { actorOf, handler, idParam, parse } from './helpers';
import { inviteStaffSchema, permanentDeleteSchema, resendInviteSchema, resetPasswordSchema, staffQuerySchema, updateStaffSchema } from '../validators/staffSchema';

/** M6-T05: the staff table API. Routes -> this file -> staffService. */

const audit = (req: AuthRequest, action: string, staffId: number) =>
  auditService.recordFromRequest(req, { action, resource: 'user', resourceId: String(staffId) });

/** A status change: run it, write the audit row, answer with the person. */
const transition = (action: string, run: (actor: ReturnType<typeof actorOf>, id: number) => Promise<unknown>) =>
  handler(async (req, res) => {
    const id = idParam(req.params.id, 'staff');
    const staff = await run(actorOf(req), id);
    await audit(req, action, id);
    res.json({ staff });
  });

/** GET /api/staff?status&role&q: the rows plus the four tab counts. */
export const list = handler(async (req, res) => {
  res.json(await staffService.listStaff(parse(staffQuerySchema, req.query, 'query')));
});

/** GET /api/staff/workload: open orders per active person. */
export const workload = handler(async (_req, res) => {
  res.json({ workload: await staffService.staffWorkload() });
});

/** PUT /api/staff/:id. adminService.updateUser writes its own audit row ('update' on the user), so there is no second one. */
export const update = handler(async (req, res) => {
  const staff = await staffService.updateStaff(actorOf(req), idParam(req.params.id, 'staff'), parse(updateStaffSchema, req.body));
  res.json({ staff });
});

/** POST /api/staff/:id/reset-password. adminService.resetUserPassword writes the audit row ('reset_password'). */
export const resetPassword = handler(async (req, res) => {
  await staffService.resetStaffPassword(actorOf(req), idParam(req.params.id, 'staff'), parse(resetPasswordSchema, req.body).password);
  res.json({ message: 'Password reset' });
});

export const deactivate = transition('staff_deactivate', staffService.deactivateStaff);
export const reactivate = transition('staff_reactivate', staffService.reactivateStaff);
/** DELETE /api/staff/:id: soft delete. */
export const remove = transition('staff_delete', staffService.deleteStaff);

/** DELETE /api/staff/:id/permanent with `{confirm: <the person's email>}`. */
export const removePermanently = handler(async (req, res) => {
  const id = idParam(req.params.id, 'staff');
  await staffService.permanentlyDeleteStaff(id, parse(permanentDeleteSchema, req.body).confirm);
  await audit(req, 'staff_permanent_delete', id);
  res.json({ message: 'Staff member permanently deleted' });
});

/** POST /api/staff/invite: make the Invited person and send the link. `link` is in this answer only. */
export const invite = handler(async (req, res) => {
  const result = await inviteService.inviteStaff(actorOf(req), parse(inviteStaffSchema, req.body));
  await audit(req, 'staff_invite', result.staff.id);
  res.status(201).json(result);
});

/** POST /api/staff/:id/resend-invite: a new link and 7 days; the old link is dead. */
export const resendInvite = handler(async (req, res) => {
  const id = idParam(req.params.id, 'staff');
  const result = await inviteService.resendInvite(actorOf(req), id, parse(resendInviteSchema, req.body).channel);
  await audit(req, 'staff_invite_resend', id);
  res.json(result);
});

/** POST /api/staff/:id/revoke-invite: the link dies; the person goes to the Deleted tab. */
export const revokeInvite = transition('staff_invite_revoke', inviteService.revokeInvite);
