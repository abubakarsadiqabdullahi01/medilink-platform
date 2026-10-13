import { sessionState } from '@/modules/auth/application/session-state';
import PractitionerLayout from './console-layout';

/**
 * The server half of the practitioner console's layout.
 *
 * Looks the session up while rendering and hands it to the client half, so the
 * navigation is in the HTML that arrives rather than appearing after the
 * scripts load, hydrate and ask for it. A missing session is passed on as
 * null, not redirected here: the client provider already turns a 401 into the
 * sign-in page, and one place deciding that keeps the two from disagreeing.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const initialSession = await sessionState();
  return <PractitionerLayout initialSession={initialSession}>{children}</PractitionerLayout>;
}
