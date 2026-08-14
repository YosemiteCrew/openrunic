export interface StatusNoteProps {
  /** The overline. Names what the note is about, so it is not a wash with no label. */
  label: string;
  /** The fact. Present tense, no hedging, no "coming soon". */
  children: string;
}

/**
 * A stated fact about where the project actually is.
 *
 * It is a bone card rather than a coloured notice on purpose. `Alert`'s caution
 * tone would read as a warning about the software, and what these notes carry
 * is not a warning: it is the project's own present tense, and the pages are
 * only trustworthy if it sits beside the claims rather than under them.
 */
export function StatusNote({ label, children }: Readonly<StatusNoteProps>) {
  return (
    <aside className="or-card or-mk-status">
      <p className="or-overline or-mk-status__label">{label}</p>
      <p className="or-small">{children}</p>
    </aside>
  );
}
