'use client';

import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/ui/api';
import { useStepUp } from '@/components/app/step-up';

/**
 * Downloads everything the platform holds about the signed-in person (M17-03).
 *
 * One place, used by the account menu every role has and by the practitioner's privacy
 * page, so the right does not depend on which screen somebody happens to be on. The
 * server asks for the password again before it answers; when it does, this asks once
 * and repeats the download rather than leaving the person with an error to decode.
 *
 * What the API returns is saved as it is, rather than shown and hoped about.
 */
export function useDownloadMyData() {
  const stepUp = useStepUp('Your download holds everything the platform keeps about you.');

  async function download(): Promise<void> {
    try {
      const data = await api.get<unknown>('/api/v1/me/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `medilink-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success('Downloaded');
    } catch (error) {
      if (stepUp.handle(error, () => void download())) return;
      toast.error('Could not build the export', { description: errorMessage(error) });
    }
  }

  return { download, dialog: stepUp.dialog };
}
