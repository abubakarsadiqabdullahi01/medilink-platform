import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { prisma } from '@/lib/db';
import { getAssignment } from '@/modules/matching/application/assignment';
import { incidentIdSchema } from '@/modules/clinical-incidents/presentation/schemas';
import {
  getIncident,
  listIncidentsForSubject,
} from '@/modules/clinical-incidents/application/incident';

/**
 * GET /api/v1/incidents/:id — the case, and every other report naming the
 * same practitioner.
 *
 * The history comes back alongside because one incident read alone cannot
 * distinguish a bad night from a pattern, and that distinction is the whole
 * of the decision compliance has to make.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: incidentIdSchema,
      permission: 'incident.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input }) => {
        const incident = await getIncident(input.id);
        // Who and when, said in words. The case screen showed a fragment of
        // each uuid, so an officer about to choose "suspend the practitioner"
        // could not see who that was. identity.users is the shared primitive
        // every module reads names from (see module-map.md).
        const [subject, shift] = await Promise.all([
          incident.subjectUserId
            ? prisma.user.findUnique({
                where: { id: incident.subjectUserId },
                select: { fullName: true, phone: true, status: true },
              })
            : null,
          incident.assignmentId ? getAssignment(incident.assignmentId) : null,
        ]);
        return {
          incident,
          subject,
          shift: shift ? { startsAt: shift.startsAt, endsAt: shift.endsAt } : null,
          subjectHistory: incident.subjectUserId
            ? await listIncidentsForSubject(incident.subjectUserId)
            : [],
        };
      },
    },
    params,
  );
}
