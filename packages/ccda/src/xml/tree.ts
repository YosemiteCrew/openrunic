/**
 * The document model both halves of the codec speak.
 *
 * Deliberately smaller than XML. There are no namespaces resolved, no
 * processing instructions kept, no comments kept and no DTD of any kind:
 * an element has a name exactly as it was written, attributes as strings, and
 * children that are either elements or text. That is everything CDA needs, and
 * every part of XML left out is a part that cannot then be got wrong.
 */

export interface XmlElement {
  /** The tag as written, prefix included: `entry`, `xsi:type` style names. */
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
}

/** A child is an element or a run of text. */
export type XmlNode = XmlElement | string;

export function isElement(node: XmlNode): node is XmlElement {
  return typeof node !== 'string';
}

/** Builds an element, dropping attributes whose value is undefined. */
export function element(
  name: string,
  attributes: Readonly<Record<string, string | undefined>> = {},
  children: readonly XmlNode[] = []
): XmlElement {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) kept[key] = value;
  }
  return { name, attributes: kept, children };
}

/**
 * Direct element children with this name.
 *
 * Absent parents are accepted and answer with nothing, the way {@link textOf}
 * and {@link attr} do. A parser walks a document that may be missing any step,
 * and making every caller write `?? element('x')` first would put a branch
 * nobody can test on every line of it.
 */
export function childrenNamed(parent: XmlElement | undefined, name: string): XmlElement[] {
  if (parent === undefined) return [];
  return parent.children.filter(isElement).filter((child) => child.name === name);
}

/** The first direct element child with this name, or undefined. */
export function childNamed(parent: XmlElement | undefined, name: string): XmlElement | undefined {
  return childrenNamed(parent, name)[0];
}

/**
 * Walks a chain of names: `path(root, 'component', 'structuredBody')`.
 *
 * Returns undefined at the first missing step rather than throwing. A section a
 * sending system chose not to include is the normal case, not an error, and a
 * parser that threw on it would refuse most real documents.
 */
export function path(
  root: XmlElement | undefined,
  ...names: readonly string[]
): XmlElement | undefined {
  let current = root;
  for (const name of names) {
    if (current === undefined) return undefined;
    current = childNamed(current, name);
  }
  return current;
}

/** Every descendant element with this name, at any depth. */
export function descendantsNamed(root: XmlElement | undefined, name: string): XmlElement[] {
  if (root === undefined) return [];
  const found: XmlElement[] = [];
  const visit = (node: XmlElement): void => {
    if (node.name === name) found.push(node);
    for (const child of node.children) {
      if (isElement(child)) visit(child);
    }
  };
  visit(root);
  return found;
}

/** All text under an element, concatenated and trimmed. */
export function textOf(node: XmlElement | undefined): string {
  if (node === undefined) return '';
  const parts: string[] = [];
  const visit = (current: XmlElement): void => {
    for (const child of current.children) {
      if (isElement(child)) visit(child);
      else parts.push(child);
    }
  };
  visit(node);
  return parts.join('').trim();
}

/** One attribute, or undefined when it is absent or empty. */
export function attr(node: XmlElement | undefined, name: string): string | undefined {
  const value = node?.attributes[name];
  return value === undefined || value === '' ? undefined : value;
}
