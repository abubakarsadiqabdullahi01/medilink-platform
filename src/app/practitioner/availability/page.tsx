import { redirect } from 'next/navigation';

/** Moved into My profile; kept so old bookmarks and links still land somewhere. */
export default function Moved() {
  redirect('/practitioner/profile?tab=availability');
}
