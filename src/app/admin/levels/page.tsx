'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';

interface Level {
  id: string;
  key: string;
  name: string;
  rank: number;
  isActive: boolean;
}

interface Overview {
  professions: { id: string; key: string; name: string; levels: Level[]; withoutLevel: number }[];
  registrationCategories: { id: string; key: string; name: string; supervisionRequired: boolean; isActive: boolean }[];
}

/**
 * The professional hierarchy: the levels within each profession, and the ways of
 * standing on the register (CFG-04).
 *
 * Nothing here is decided by the platform. What the levels are for doctors, nurses,
 * pharmacists, laboratory scientists and radiographers, and which registrations are
 * provisional or need supervision, are the regulators' to say. Until a profession has
 * a level defined, requests for it do not ask for one; once it does, every new request
 * must name one, so pilot data is born with it. Levels are retired, never deleted:
 * a shift or a practitioner that holds one keeps what it meant.
 */
export default function LevelsPage() {
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ['hierarchy'],
    queryFn: () => api.get<Overview>('/api/v1/cadre-levels'),
  });

  const [drafts, setDrafts] = useState<Record<string, { name: string; rank: string }>>({});
  const [category, setCategory] = useState({ name: '', supervisionRequired: false });

  // The reference data is cached for the session and carries the same lists to every
  // form, so it is refreshed with them.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['hierarchy'] });
    void queryClient.invalidateQueries({ queryKey: ['reference'] });
  };

  const addLevel = useMutation({
    mutationFn: ({ professionId }: { professionId: string }) => {
      const draft = drafts[professionId] ?? { name: '', rank: '' };
      return api.post('/api/v1/cadre-levels', {
        professionalCategoryId: professionId,
        name: draft.name,
        rank: Number(draft.rank),
      });
    },
    onSuccess: (_data, { professionId }) => {
      toast.success('Level added');
      setDrafts((current) => ({ ...current, [professionId]: { name: '', rank: '' } }));
      refresh();
    },
    onError: (error) => toast.error('Could not add it', { description: errorMessage(error) }),
  });

  const toggleLevel = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.post(`/api/v1/cadre-levels/${id}/active`, { active }),
    onSuccess: refresh,
    onError: (error) => toast.error('Could not change it', { description: errorMessage(error) }),
  });

  const addCategory = useMutation({
    mutationFn: () => api.post('/api/v1/registration-categories', category),
    onSuccess: () => {
      toast.success('Registration category added');
      setCategory({ name: '', supervisionRequired: false });
      refresh();
    },
    onError: (error) => toast.error('Could not add it', { description: errorMessage(error) }),
  });

  const toggleCategory = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.post(`/api/v1/registration-categories/${id}/active`, { active }),
    onSuccess: refresh,
    onError: (error) => toast.error('Could not change it', { description: errorMessage(error) }),
  });

  return (
    <>
      <PageHeader
        title="Levels"
        description="The levels within each profession, and the ways of standing on the register. They are the regulators' to state; this is where they are entered."
      />

      {overview.isPending ? (
        <QueueSkeleton rows={3} />
      ) : overview.isError ? (
        <ErrorState
          error={overview.error}
          onRetry={() => void overview.refetch()}
          retrying={overview.isFetching}
        />
      ) : (
        <div className="space-y-6">
          <Alert variant="info">
            <AlertDescription>
              While a profession has no level here, a request for it does not ask for one. Once it has
              one, every new request for that profession must name a level, and only practitioners whose
              level has been recorded against their registration are offered it. Rank orders the levels
              within a profession, lowest for the most junior; leave gaps (10, 20, 30) so another can be
              added between.
            </AlertDescription>
          </Alert>

          {overview.data.professions.map((profession) => {
            const draft = drafts[profession.id] ?? { name: '', rank: '' };
            return (
              <Card key={profession.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">{profession.name}</CardTitle>
                  <CardDescription>
                    {profession.levels.length === 0
                      ? 'No levels yet, so requests for this profession do not ask for one.'
                      : `${profession.levels.filter((level) => level.isActive).length} in use.`}
                    {profession.withoutLevel > 0
                      ? ` ${profession.withoutLevel} ${profession.withoutLevel === 1 ? 'practitioner has' : 'practitioners have'} no level recorded${
                          profession.levels.length === 0
                            ? ', and would not be offered a shift once there is one. Record theirs first (Practitioners, then Identity and registration).'
                            : ', so a shift that names a level is not offered to them.'
                        }`
                      : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {profession.levels.length > 0 ? (
                    <ul className="divide-y rounded-md border">
                      {profession.levels.map((level) => (
                        <li key={level.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                          <div className="min-w-0">
                            <p className="font-medium">{level.name}</p>
                            <p className="text-xs text-muted-foreground">Rank {level.rank}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            {!level.isActive ? <Badge variant="secondary">Retired</Badge> : null}
                            <Button
                              variant="outline"
                              size="sm"
                              loading={toggleLevel.isPending && toggleLevel.variables?.id === level.id}
                              onClick={() => toggleLevel.mutate({ id: level.id, active: !level.isActive })}
                            >
                              {level.isActive ? 'Retire' : 'Bring back'}
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <form
                    className="flex flex-wrap items-end gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      addLevel.mutate({ professionId: profession.id });
                    }}
                  >
                    <div className="min-w-[14rem] flex-1 space-y-1.5">
                      <Label htmlFor={`level-name-${profession.key}`}>Level</Label>
                      <Input
                        id={`level-name-${profession.key}`}
                        value={draft.name}
                        maxLength={80}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [profession.id]: { ...draft, name: event.target.value } }))
                        }
                      />
                    </div>
                    <div className="w-28 space-y-1.5">
                      <Label htmlFor={`level-rank-${profession.key}`}>Rank</Label>
                      <Input
                        id={`level-rank-${profession.key}`}
                        inputMode="numeric"
                        value={draft.rank}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [profession.id]: { ...draft, rank: event.target.value } }))
                        }
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={draft.name.trim().length < 2 || !/^\d+$/.test(draft.rank)}
                      loading={addLevel.isPending && addLevel.variables?.professionId === profession.id}
                    >
                      Add level
                    </Button>
                  </form>
                </CardContent>
              </Card>
            );
          })}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Registration categories</CardTitle>
              <CardDescription>
                How somebody stands on the register: full, provisional, intern, post-basic. One that needs
                supervision can be offered only shifts that say supervision is available.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {overview.data.registrationCategories.length > 0 ? (
                <ul className="divide-y rounded-md border">
                  {overview.data.registrationCategories.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="font-medium">{row.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.supervisionRequired ? 'Needs supervision' : 'Practises unsupervised'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {!row.isActive ? <Badge variant="secondary">Retired</Badge> : null}
                        <Button
                          variant="outline"
                          size="sm"
                          loading={toggleCategory.isPending && toggleCategory.variables?.id === row.id}
                          onClick={() => toggleCategory.mutate({ id: row.id, active: !row.isActive })}
                        >
                          {row.isActive ? 'Retire' : 'Bring back'}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">None yet.</p>
              )}

              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  addCategory.mutate();
                }}
              >
                <div className="min-w-[14rem] flex-1 space-y-1.5">
                  <Label htmlFor="category-name">Category</Label>
                  <Input
                    id="category-name"
                    value={category.name}
                    maxLength={80}
                    onChange={(event) => setCategory({ ...category, name: event.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={category.supervisionRequired}
                    onChange={(event) => setCategory({ ...category, supervisionRequired: event.target.checked })}
                  />
                  Needs supervision
                </label>
                <Button type="submit" disabled={category.name.trim().length < 2} loading={addCategory.isPending}>
                  Add category
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
