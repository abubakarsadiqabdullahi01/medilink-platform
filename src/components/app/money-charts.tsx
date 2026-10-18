'use client';

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

/**
 * The charts the facility dashboard and the finance console draw, in one file
 * so the charting library is a single chunk that those pages load after their
 * tiles and navigation have appeared (see the `dynamic` imports there).
 *
 * Both read the same validated colour slots — see docs/interfaces.md: fixed
 * slots of a categorical palette checked for contrast and colour-vision
 * separation in both themes, not a hue picked per chart.
 */

/** Kobo on the axis would be six digits of noise; naira is what people say. */
const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;

/**
 * The same, short, for an axis: "₦1.5M", "₦500k". Full figures went in the tooltip; on the axis
 * they were wider than the space left for them and lost their leading digits (a column of
 * "000,000"), which is worse than abbreviating.
 */
const nairaShort = (kobo: number) => {
  const value = Math.round(kobo / 100);
  if (value >= 1_000_000) return `₦${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `₦${+(value / 1_000).toFixed(1)}k`;
  return `₦${value}`;
};

const SPEND_CONFIG = {
  invoiced: { label: 'Invoiced', color: 'hsl(var(--chart-1))' },
  paid: { label: 'Paid', color: 'hsl(var(--chart-2))' },
} satisfies ChartConfig;

const FULFILMENT_CONFIG = {
  needed: { label: 'People needed', color: 'hsl(var(--chart-2))' },
  filled: { label: 'People confirmed', color: 'hsl(var(--chart-1))' },
} satisfies ChartConfig;

const OUTSTANDING_CONFIG = {
  outstanding: { label: 'Outstanding', color: 'hsl(var(--chart-1))' },
} satisfies ChartConfig;

/** Invoiced against paid, by month. */
export function SpendChart({
  data,
  height,
  yAxisWidth,
  legend,
}: {
  data: { month: string; invoiced: number; paid: number }[];
  height: number;
  yAxisWidth: number;
  legend: boolean;
}) {
  return (
    <ChartContainer config={SPEND_CONFIG} className="w-full" style={{ height }}>
      <BarChart data={data} accessibilityLayer>
        {/* Horizontal only: vertical rules add ink and answer nothing a
            categorical axis has not already said. */}
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={yAxisWidth} tickFormatter={nairaShort} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value) => naira(Number(value))} />} />
        {/* 2px surface gap between adjacent bars, and rounded data-ends
            anchored to the baseline. */}
        <Bar dataKey="invoiced" fill="var(--color-invoiced)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="paid" fill="var(--color-paid)" radius={[4, 4, 0, 0]} />
        {legend ? <ChartLegend content={<ChartLegendContent />} /> : null}
      </BarChart>
    </ChartContainer>
  );
}

/** People needed against people confirmed, by week. */
export function FulfilmentChart({ data }: { data: { week: string; needed: number; filled: number }[] }) {
  return (
    <ChartContainer config={FULFILMENT_CONFIG} className="h-[240px] w-full">
      <BarChart data={data} accessibilityLayer>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="needed" fill="var(--color-needed)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="filled" fill="var(--color-filled)" radius={[4, 4, 0, 0]} />
        <ChartLegend content={<ChartLegendContent />} />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * Outstanding by facility, largest first. One series, so one hue and no legend:
 * the facility names on the axis carry the identity, not the colour.
 */
export function OutstandingChart({ data }: { data: { name: string; outstanding: number }[] }) {
  return (
    <ChartContainer config={OUTSTANDING_CONFIG} className="h-[260px] w-full">
      <BarChart data={data} layout="vertical" accessibilityLayer>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={nairaShort} />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={140} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value) => naira(Number(value))} />} />
        <Bar dataKey="outstanding" radius={[0, 4, 4, 0]}>
          {data.map((row) => (
            <Cell key={row.name} fill="var(--color-outstanding)" />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
