/**
 * The shipped horizontal lockup, drawn through a mask so it takes the ink of
 * whatever band it sits on: espresso on the bone masthead, bone on the espresso
 * footer, from one file and with no colourway to pick.
 *
 * It reuses `@openrunic/ui`'s own `.or-logo--mask` rules rather than restating
 * them, and points them at `/assets/logo/lockup-horizontal.svg` through the
 * `--or-logo-src` custom property those rules read. The mark is a shipped file,
 * never redrawn and never set in a font.
 *
 * Its box is sized in CSS rather than through a prop, because the two places it
 * appears are the masthead and the footer and both are stylesheet decisions.
 *
 * This is markup plus library CSS rather than the library's `Logo` component
 * because the public pages are server components: `@openrunic/ui` builds to one
 * module whose top level imports `useState`, so importing anything from it
 * pulls the whole library across the client boundary. The marketing layout
 * explains why that trade lands differently here than on the staff screens.
 */
export function Lockup() {
  return <span className="or-logo or-logo--mask or-mk-lockup" role="img" aria-label="openrunic" />;
}
