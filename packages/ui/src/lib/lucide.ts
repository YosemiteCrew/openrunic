import type { ComponentType, SVGProps } from 'react';
import * as lucideReact from 'lucide-react';

/**
 * Props every Lucide icon component accepts. Declared locally rather than imported from
 * lucide-react so the library never depends on that package's type export names.
 */
export interface LucideIconProps extends SVGProps<SVGSVGElement> {
  size?: string | number;
  absoluteStrokeWidth?: boolean;
}

export type LucideIconComponent = ComponentType<LucideIconProps>;

/**
 * Brand stroke weight. The guidelines ask for 1.5-1.75px; Lucide's 2px default was only
 * forced on the design system because it drew icons through a CSS mask, which the npm
 * package removes. Pass this to every icon so the whole library stays consistent.
 */
export const ICON_STROKE_WIDTH = 1.75;

/* The module namespace is the icon registry: lucide-react exports one PascalCase
   component per icon. This cast is the single typed boundary around that untyped
   lookup - nothing else in the library reaches into the namespace. */
const registry = lucideReact as unknown as Record<string, LucideIconComponent | undefined>;

const resolved = new Map<string, LucideIconComponent | undefined>();

/** 'heart-pulse' -> 'HeartPulse', 'arrow-up-1-0' -> 'ArrowUp10', 'Check' -> 'Check'. */
export function toLucideName(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Look up a Lucide icon component by kebab-case slug - the shape every OpenRunic
 * `icon` / `iconLeft` / `iconRight` prop takes. Returns undefined for an unknown slug, so
 * a typo degrades to a missing icon instead of a crash.
 */
export function resolveLucideIcon(slug: string): LucideIconComponent | undefined {
  if (resolved.has(slug)) return resolved.get(slug);
  const icon = registry[toLucideName(slug)];
  resolved.set(slug, icon);
  return icon;
}
