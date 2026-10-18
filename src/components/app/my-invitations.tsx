'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Mail } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/components/app/format';
import { FACILITY_STAFF_ROLES } from '@/lib/ui/staff-roles';

interface MyInvitation {
  id: string;
  facilityId: string;
  facilityName: string;
  roleKey: string;
  invitedByName: string;
  expiresAt: string;
}

const roleLabel = (key: string) =>
  FACILITY_STAFF_ROLES.find((role) => role.key === key)?.label.toLowerCase() ?? 'staff';

/**
 * Invitations to work for a facility that are waiting for the person signed in, and nobody else's.
 *
 * The server finds them by the phone number this person has verified, so somebody invited before
 * they registered sees theirs the first time they sign in. Nothing here gives access by itself:
 * accepting asks the server, which checks again that whoever sent it can still give that role. It
 * draws nothing when there is nothing waiting, so it can sit at the top of any console's home.
 */
export function MyInvitations() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = ['staff-invitations', 'mine'];

  const waiting = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ invitations: MyInvitation[] }>('/api/v1/staff-invitations/mine'),
    retry: false,
  });

  const answer = useMutation({
    mutationFn: (input: { invitation: MyInvitation; decision: 'accept' | 'decline' }) =>
      api.post(`/api/v1/staff-invitations/${input.invitation.id}/respond`, { decision: input.decision }),
    onSuccess: async (_data, { invitation, decision }) => {
      if (decision === 'accept') {
        toast.success(`You now work for ${invitation.facilityName}`, {
          description: `As ${roleLabel(invitation.roleKey)}.`,
        });
        // What this person may do has just changed: the console reads it again before it draws.
        await queryClient.invalidateQueries({ queryKey: ['session'] });
        await queryClient.invalidateQueries({ queryKey: key });
        router.push('/facility');
        return;
      }
      toast.success('Invitation declined');
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error) => {
      toast.error('Could not answer that invitation', { description: errorMessage(error) });
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const rows = waiting.data?.invitations ?? [];
  if (rows.length === 0) return null;

  return (
    <section aria-label="Invitations" className="mb-6 space-y-2">
      {rows.map((invitation) => (
        <Card key={invitation.id} className="border-primary/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <Mail className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="font-medium">
                  {invitation.facilityName} has invited you to join as {roleLabel(invitation.roleKey)}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Sent by {invitation.invitedByName}. Answer by {formatDate(invitation.expiresAt)}.
                  Nothing changes until you accept.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={answer.isPending}
                onClick={() => answer.mutate({ invitation, decision: 'decline' })}
              >
                Decline
              </Button>
              <Button
                loading={answer.isPending && answer.variables?.invitation.id === invitation.id}
                onClick={() => answer.mutate({ invitation, decision: 'accept' })}
              >
                Accept
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
