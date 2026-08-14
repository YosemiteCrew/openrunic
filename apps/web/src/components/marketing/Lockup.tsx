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
 *
 * ## Why this is a labelled box and not an `<img>`
 *
 * A native `<img>` cannot take its ink from the band. `lockup-horizontal.svg`
 * strokes in `currentColor`, and inside an `<img>` that resolves against the
 * image's own document rather than this one, so the same file that reads
 * espresso here renders near-black on the espresso footer. Painting it as a
 * mask is what makes one file serve both bands, and a mask needs a box.
 *
 * Reaching `<img>` therefore means committing the two baked colourway builds
 * instead and naming a band at every call site, which is the copy
 * `apps/web/public/README.md` deliberately leaves out of the repository and the
 * choice the design above exists to avoid. `Logo`'s `currentColor` branch,
 * `Glyph`, `Footer` and `SideNav` in `@openrunic/ui` all paint the mark this
 * same way and all label the box the same way, so this is the house spelling
 * rather than an app-local shortcut. The accessibility tree is the same either
 * way - role `img`, named "openrunic" - which the test beside this file pins.
 */
export function Lockup() {
  return <span className="or-logo or-logo--mask or-mk-lockup" role="img" aria-label="openrunic" />;
}
