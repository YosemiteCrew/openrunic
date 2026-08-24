'use client';

import { formatCount } from '@openrunic/i18n';
import type { Translator } from '@openrunic/i18n';
import { Badge, Card } from '@openrunic/ui';
import Link from 'next/link';
import type { ReactElement } from 'react';

import type { DashboardTile } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { Sparkline } from './Sparkline';
import { TREND_LABELS, trendOf } from './trend';

/**
 * One number on the practice dashboard.
 *
 * A healthy practice's dashboard should look almost boring, so the tint only
 * appears on a tile whose threshold is breached, and the state is always a word
 * as well ("Above threshold"), never the colour alone. Every tile is a link:
 * the whole point of the screen is reaching the workbench that owns the number
 * in one click.
 */

export interface StatTileProps {
  tile: DashboardTile;
}

/**
 * A money tile formats as money; everything else keeps its own unit word.
 *
 * The count goes through `formatCount` on the reader's own locale rather than
 * `toLocaleString('en-US')`, which put "10,000" in front of a Spanish reader
 * whose language groups it "10.000". Money still goes through `formatMoney`,
 * which reads a fixed locale of its own in `lib/format.ts`; that is the same
 * problem one layer down and is being fixed with the rest of that file.
 */
function readValue(tile: DashboardTile, locale: string): { text: string; unit: string | null } {
  if (tile.unit === '$') {
    return { text: formatMoney(tile.value).text, unit: null };
  }
  return { text: formatCount(tile.value, locale), unit: tile.unit };
}

/**
 * The sentence beside the sparkline: how long a window, and which way it went.
 *
 * One message with two placeholders rather than a fixed prefix joined to a
 * word. "Last 7 days, " + trend put the window first and the direction last,
 * which is an English sentence this codebase was imposing on every language;
 * a translator now owns the whole frame and decides where each part sits.
 *
 * The window comes from the series rather than being written into the message.
 * `DashboardTile.series` is documented as seven days, and a number copied out
 * of a doc comment into three translations is a number that goes stale in
 * three places.
 */
function trendSentence(t: Translator, tile: DashboardTile): string {
  return t('reports.tile.trend', {
    days: formatCount(tile.series.length, t.locale),
    trend: t(TREND_LABELS[trendOf(tile.series)].labelKey),
  });
}

export function StatTile({ tile }: Readonly<StatTileProps>): ReactElement {
  const t = useTranslator();
  const { text, unit } = readValue(tile, t.locale);

  return (
    <Card className="or-stat" data-state={tile.state}>
      <p className="or-overline or-stat__label">{tile.label}</p>

      <p className="or-stat__value">
        <span className="or-stat__number">{text}</span>
        {unit ? <span className="or-small or-stat__unit"> {unit}</span> : null}
      </p>

      <div className="or-stat__state">
        {/* A tile's state is already the badge's tone: same three words, same
            meaning. Mapping one onto the other only creates somewhere for them
            to disagree. */}
        <Badge tone={tile.state}>{tile.stateLabel}</Badge>
      </div>

      <p className="or-small or-stat__detail">{tile.detail}</p>

      <div className="or-stat__trend">
        <Sparkline values={tile.series} />
        <span className="or-caption or-stat__trend-label">{trendSentence(t, tile)}</span>
      </div>

      {/* The label is interpolated as it arrived. It used to be lowercased to
          make "Open unsigned notes" read as a sentence, which applied an English
          orthographic rule to a string the server owns - and to every language
          the frame is translated into, where a mid-sentence noun may have to
          keep its capital. */}
      <Link className="or-stat__link" href={tile.href}>
        {t('reports.tile.open', { label: tile.label })}
      </Link>
    </Card>
  );
}
