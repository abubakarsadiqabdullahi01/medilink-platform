'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

/**
 * Growth, across the three things a pilot actually wants to see moving: new
 * facilities, new practitioners, and how much the platform gets used once
 * they are on it. Registration without usage is a pipeline; usage without
 * registration is a ceiling — three lines rather than one headline is what
 * tells those two problems apart.
 *
 * Usage is muted rather than a third bright hue: `docs/interfaces.md`
 * documents the two chart colours as slots of a validated categorical
 * palette (contrast and colour-vision separation checked for both themes),
 * and there is no third validated slot to draw from. It also carries its own
 * axis — registrations run in the tens and usage in the thousands, and one
 * shared axis would flatten the smaller two into an invisible line along the
 * bottom.
 */
const GROWTH_CHART_CONFIG = {
  facilities: { label: 'Facilities registered', color: 'hsl(var(--chart-1))' },
  practitioners: { label: 'Practitioners registered', color: 'hsl(var(--chart-2))' },
  usage: { label: 'Platform activity', color: 'hsl(var(--muted-foreground))' },
} satisfies ChartConfig;

export interface GrowthPoint {
  month: string;
  facilities: number;
  practitioners: number;
  usage: number;
}

/**
 * The growth chart, in a file of its own so the charting library is a separate
 * chunk that the dashboard loads after it has drawn its tiles.
 */
export default function GrowthChart({
  series,
  facilities,
  practitioners,
  usage,
}: {
  series: GrowthPoint[];
  facilities: boolean;
  practitioners: boolean;
  usage: boolean;
}) {
  return (
    <ChartContainer config={GROWTH_CHART_CONFIG} className="h-[260px] w-full">
                    <BarChart data={series} accessibilityLayer>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                      {/* Two axes because registrations run in the tens and
                          activity in the thousands — sharing one would draw
                          the smaller two as a flat line along the bottom. */}
                      <YAxis
                        yAxisId="count"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        width={40}
                        allowDecimals={false}
                      />
                      <YAxis
                        yAxisId="activity"
                        orientation="right"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        width={56}
                        allowDecimals={false}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      {facilities ? (
                        <Bar
                          yAxisId="count"
                          dataKey="facilities"
                          fill="var(--color-facilities)"
                          radius={[4, 4, 0, 0]}
                        />
                      ) : null}
                      {practitioners ? (
                        <Bar
                          yAxisId="count"
                          dataKey="practitioners"
                          fill="var(--color-practitioners)"
                          radius={[4, 4, 0, 0]}
                        />
                      ) : null}
                      {usage ? (
                        <Bar
                          yAxisId="activity"
                          dataKey="usage"
                          fill="var(--color-usage)"
                          radius={[4, 4, 0, 0]}
                        />
                      ) : null}
                    </BarChart>
                  </ChartContainer>
  );
}
