'use client';

import { Badge, Card } from '@openrunic/ui';
import Link from 'next/link';
import type { ReactElement } from 'react';

import type { DashboardTile } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { Sparkline } from './Sparkline';
import { trendKey } from './trend';

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

/** A money tile formats as money; everything else keeps its own unit word. */
function readValue(tile: DashboardTile): { text: string; unit: string | null } {
  if (tile.unit === '$') {
    return { text: formatMoney(tile.value).text, unit: null };
  }
  return { text: tile.value.toLocaleString('en-US'), unit: tile.unit };
}

export function StatTile({ tile }: Readonly<StatTileProps>): ReactElement {
  const t = useTranslator();
  const { text, unit } = readValue(tile);

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
        <span className="or-caption or-stat__trend-label">
          {t('reports.tile.trend', { trend: t(trendKey(tile.series)) })}
        </span>
      </div>

      {/* The label is the API's own wording for the number, so the link is the
          interface's sentence wrapped around a value it did not name. */}
      <Link className="or-stat__link" href={tile.href}>
        {t('reports.tile.open', { label: tile.label.toLowerCase() })}
      </Link>
    </Card>
  );
}
