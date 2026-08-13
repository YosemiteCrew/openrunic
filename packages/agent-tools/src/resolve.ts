import { TOOL_ALLOWLIST, type ToolAllowlist } from './allowlist.js';
import type { AgentPrincipal } from './principal.js';
import type { AgentTool, ToolRegistry } from './registry.js';
import type { TrustClass } from './tiers.js';

/**
 * Which tools this caller can see, which is a stronger statement than which
 * tools this caller can use.
 *
 * A tool that is not granted to the principal and the surface is **invisible**,
 * not refused. The model is never told a capability exists that this caller
 * cannot reach, for two reasons: a refusal is a disclosure ("so there *is* an
 * audit query"), and a tool the model can name is a tool the model will spend
 * turns trying to call.
 *
 * There are two enforcement points and they are not redundant. Filtering here,
 * at advertise time, is an accuracy and prompt-budget win. Re-checking at
 * execute time, against the caller's own session, is the actual control.
 */

export interface ResolveOptions {
  allowlist?: ToolAllowlist;
  /**
   * Restrict to one half of the reader/writer split. The reader loop passes
   * `'reader'`, and that is what makes "the loop that ingests untrusted content
   * holds no write tool" structural rather than a matter of prompting.
   */
  trustClass?: TrustClass;
  /**
   * Cap on how many tools are exposed to the model. Small local models degrade
   * badly past roughly ten, and the set is role-scoped anyway, so the cap is an
   * accuracy win and a security win at once. Applied last, so it never widens.
   */
  maxToolsExposed?: number;
}

/** Every tool the principal may reach, in registry order. */
export function resolveTools(
  registry: ToolRegistry,
  principal: AgentPrincipal,
  options: ResolveOptions = {}
): AgentTool[] {
  const allowlist = options.allowlist ?? TOOL_ALLOWLIST;
  const granted = grantedIds(allowlist, principal);

  const visible = registry.tools.filter((tool) => {
    if (!granted.has(tool.id)) return false;
    if (!tool.surfaces.includes(principal.surface)) return false;
    if (options.trustClass !== undefined && tool.trustClass !== options.trustClass) return false;
    return holdsEveryScope(principal, tool);
  });

  return options.maxToolsExposed === undefined
    ? visible
    : visible.slice(0, options.maxToolsExposed);
}

/**
 * One tool, or `undefined`.
 *
 * `undefined` is returned both for an id that does not exist and for an id the
 * caller may not reach, and callers must not distinguish the two. That is the
 * difference between invisible and refused.
 */
export function resolveTool(
  registry: ToolRegistry,
  principal: AgentPrincipal,
  id: string,
  options: ResolveOptions = {}
): AgentTool | undefined {
  return resolveTools(registry, principal, options).find((tool) => tool.id === id);
}

/** The tool ids granted to any of the principal's roles on its surface. */
export function grantedIds(allowlist: ToolAllowlist, principal: AgentPrincipal): Set<string> {
  const surface = allowlist[principal.surface];
  const granted = new Set<string>();
  for (const role of principal.roleIds) {
    for (const id of surface[role] ?? []) granted.add(id);
  }
  return granted;
}

function holdsEveryScope(principal: AgentPrincipal, tool: AgentTool): boolean {
  const held = new Set(principal.scopes);
  return tool.requiredScopes.every((scope) => held.has(scope));
}
