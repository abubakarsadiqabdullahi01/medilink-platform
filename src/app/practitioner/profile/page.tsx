'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useReference } from '@/lib/ui/reference';
import { useSession } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/app/page-shell';
import { PhotoField } from './photo-field';

interface Profile {
  id: string;
  professionalCategoryId: string;
  specialtyId: string | null;
  yearsOfExperience: number;
  bio: string | null;
  photoObjectKey: string | null;
  homeStateId: string | null;
  homeLgaId: string | null;
  travelPreference: string;
}

const TRAVEL = [
  ['SAME_LGA', 'Only my own local government area'],
  ['SAME_STATE', 'Anywhere in my state'],
  ['ANYWHERE', 'Anywhere in Nigeria'],
] as const;

/**
 * The profile, which is also half the matcher's input.
 *
 * Travel preference and home LGA are not decoration: the engine scores
 * proximity against them and excludes a shift outside what somebody said they
 * would travel to. The form says so, because a practitioner who leaves the
 * default has effectively narrowed their own offers without being told.
 */
export default function ProfilePage() {
  const session = useSession();
  const reference = useReference();
  const queryClient = useQueryClient();

  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<Profile>('/api/v1/practitioners/me'),
    retry: false,
  });

  const [categoryId, setCategoryId] = useState('');
  const [specialtyId, setSpecialtyId] = useState('');
  const [years, setYears] = useState('0');
  const [bio, setBio] = useState('');
  const [stateId, setStateId] = useState('');
  const [lgaId, setLgaId] = useState('');
  const [travel, setTravel] = useState('SAME_STATE');

  // Seeded once the profile arrives; after that the form is the source of
  // truth, or typing would be overwritten on every refetch.
  useEffect(() => {
    if (!profile.data) return;
    setCategoryId(profile.data.professionalCategoryId);
    setSpecialtyId(profile.data.specialtyId ?? '');
    setYears(String(profile.data.yearsOfExperience));
    setBio(profile.data.bio ?? '');
    setStateId(profile.data.homeStateId ?? '');
    setLgaId(profile.data.homeLgaId ?? '');
    setTravel(profile.data.travelPreference);
  }, [profile.data]);

  const exists = Boolean(profile.data);
  const specialties = (reference.data?.specialties ?? []).filter(
    (row) => row.categoryId === categoryId,
  );
  const lgas = (reference.data?.lgas ?? []).filter((row) => row.stateId === stateId);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        professionalCategoryId: categoryId,
        specialtyId: specialtyId || undefined,
        yearsOfExperience: Number(years || '0'),
        bio: bio.trim() || undefined,
        homeStateId: stateId || undefined,
        homeLgaId: lgaId || undefined,
        travelPreference: travel,
      };
      return exists
        ? api.patch('/api/v1/practitioners/me', body)
        : api.post('/api/v1/practitioners/me', body);
    },
    onSuccess: () => {
      toast.success('Saved');
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['eligibility'] });
    },
    onError: (error) => toast.error('Could not save', { description: errorMessage(error) }),
  });

  return (
    <>
      <PageHeader
        title="Profile"
        description={`${session.user.fullName} · ${session.user.phone}`}
      />

      {profile.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              {exists ? 'Your details' : 'Create your profile'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!exists ? (
              <Alert variant="warning">
                <TriangleAlert />
                <AlertDescription>
                  You have no profile yet, so you cannot be matched to anything. This is the first
                  step.
                </AlertDescription>
              </Alert>
            ) : null}

            <PhotoField hasPhoto={Boolean(profile.data?.photoObjectKey)} profileExists={exists} />
            <Separator />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Profession</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose one" />
                  </SelectTrigger>
                  <SelectContent>
                    {(reference.data?.professionalCategories ?? []).map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Specialty</Label>
                <Select
                  value={specialtyId}
                  onValueChange={setSpecialtyId}
                  disabled={specialties.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={specialties.length === 0 ? 'None' : 'Optional'} />
                  </SelectTrigger>
                  <SelectContent>
                    {specialties.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="years">Years of experience</Label>
                <Input
                  id="years"
                  type="number"
                  min={0}
                  value={years}
                  onChange={(event) => setYears(event.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>State you live in</Label>
                <Select
                  value={stateId}
                  onValueChange={(value) => {
                    setStateId(value);
                    setLgaId('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose one" />
                  </SelectTrigger>
                  <SelectContent>
                    {(reference.data?.states ?? []).map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Local government area</Label>
                <Select value={lgaId} onValueChange={setLgaId} disabled={lgas.length === 0}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={lgas.length === 0 ? 'Choose a state first' : 'Choose one'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {lgas.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>How far you will travel</Label>
                <Select value={travel} onValueChange={setTravel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRAVEL.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Your local government area and how far you will travel are what the matcher scores
              proximity on. Narrowing them narrows the shifts you are offered.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="bio">About you (optional)</Label>
              <Textarea
                id="bio"
                rows={3}
                placeholder="Where you have worked, what you are good at."
                value={bio}
                onChange={(event) => setBio(event.target.value)}
              />
            </div>

            <Button disabled={!categoryId} loading={save.isPending} onClick={() => save.mutate()}>
              {exists ? 'Save changes' : 'Create profile'}
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}
