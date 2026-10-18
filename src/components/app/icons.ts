import {
  Activity,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarX,
  ChartColumn,
  CircleCheck,
  CircleX,
  Clock,
  FileCheck2,
  FileSignature,
  Gauge,
  Gavel,
  HandCoins,
  Inbox,
  Info,
  Layers,
  LayoutDashboard,
  MessageSquareText,
  Percent,
  ReceiptText,
  Scale,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Timer,
  TriangleAlert,
  UserRound,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * One icon for each thing Medilink talks about.
 *
 * The same concept wears the same icon on every screen and in every console. It
 * had not been so: an invoice was a document in one menu and a receipt in another,
 * and a timesheet shared the receipt with it. A reader who learns what a symbol
 * means should never have to relearn it, and a nurse who reads with difficulty
 * leans on the symbol more than on the word.
 *
 * To add an icon, add a concept here first. A screen picks a concept, never a
 * lucide import of its own for something this list already names.
 */
export const ICON = {
  // Where you are
  dashboard: LayoutDashboard,

  // Work
  shift: CalendarClock,
  roster: Users,
  offer: Inbox,
  timesheet: Timer,

  // Money
  invoice: ReceiptText,
  payout: HandCoins,
  earnings: Wallet,
  finance: ChartColumn,
  rate: Percent,
  rateFloor: Scale,

  // People and places
  practitioner: UserRound,
  facility: Building2,
  staff: UsersRound,

  // Trust and safety
  credential: FileCheck2,
  sanction: ShieldAlert,
  incident: TriangleAlert,
  dispute: Gavel,
  unhonoured: CalendarX,
  dataRequest: ShieldCheck,
  audit: ScrollText,

  // Running the platform
  suggestion: MessageSquareText,
  performance: Gauge,
  health: Activity,
  terms: FileSignature,
  holiday: CalendarDays,
  level: Layers,
} satisfies Record<string, LucideIcon>;

export type Concept = keyof typeof ICON;

/**
 * What a status looks like when colour is not available to the reader.
 *
 * Colour alone is not a signal (WCAG 1.4.1): somebody with colour-blindness, or a
 * phone in sunlight, must still be able to tell "approved" from "rejected" before
 * they read the word. Neutral statuses carry no icon: there is nothing to warn of.
 */
export const STATUS_ICON = {
  success: CircleCheck,
  warning: Clock,
  destructive: CircleX,
  info: Info,
} satisfies Record<string, LucideIcon>;
