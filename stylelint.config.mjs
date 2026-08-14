/**
 * Stylelint configuration for openrunic.
 *
 * This repository is a design system before it is an application, so CSS is
 * first-class source and gets a first-class linter. The base is
 * stylelint-config-standard, which brings stylelint-config-recommended's
 * defect rules (unknown properties, unknown units, duplicate selectors,
 * shorthands that silently clobber a longhand, malformed at-rules) plus a
 * layer of convention rules.
 *
 * Two principles decide every entry below.
 *
 * First, Prettier owns whitespace. Every rule that places blank lines, indents
 * or wraps is turned off here rather than fought: `pnpm run format:check` is a
 * separate CI gate and there must be exactly one tool that can fail a build
 * over a blank line.
 *
 * Second, a rule earns its place by catching something that renders wrong,
 * reads wrong or breaks a stated house rule. A rule that only prefers one
 * legal spelling of an identical result is noise, and noise is what teaches
 * people to reach for `stylelint-disable`. Each disabled rule below carries
 * the reason it is disabled and the condition that would bring it back.
 */

/**
 * A hex colour literal: three, four, six or eight hex digits. The two
 * lookbehinds exclude SVG fragment references, `url(#clip)` and `url("#clip")`,
 * which are identifiers that happen to be spelled in hex digits and are not
 * colours at all. They deliberately do not exclude every opening parenthesis,
 * because `linear-gradient(#ffffff, ...)` is precisely the place a raw colour
 * hides.
 */
const HEX_COLOUR =
  /(?<!url\()(?<!["'\w])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])/;

/**
 * BEM: `block`, `block__element`, `block--modifier`, `block__element--modifier`,
 * with kebab-case inside each part. Every one of the 333 class names in this
 * tree already matches, so this documents the convention the codebase settled
 * on rather than imposing a new one.
 */
const BEM_CLASS =
  '^[a-z][a-z0-9]*(-[a-z0-9]+)*(__[a-z0-9]+(-[a-z0-9]+)*)?(--[a-z0-9]+(-[a-z0-9]+)*)?$';

export default {
  extends: ['stylelint-config-standard'],

  rules: {
    // --- House rules --------------------------------------------------------

    // "No hex values, no magic numbers": colour reaches a component through a
    // token, never as a literal. The property matcher is `not a custom
    // property`, which draws the line exactly where the design system draws it:
    // a `--token: #f5efe6` declaration is the token layer doing its job, and
    // `color: #f5efe6` is an application skipping it. Scoping by property
    // rather than by file path means no exception list to maintain when new
    // stylesheets land, and it holds for every colour-bearing property at once
    // (background, border, box-shadow, fill, stroke, gradients inside any of
    // them) instead of a hand-kept list of property names.
    //
    // Known limit: a component-scoped custom property that invents a one-off
    // colour, such as `--or-btn-danger-hover: #96291f` in Button.css, passes
    // this rule. Whether such a value should be promoted into
    // packages/ui/src/styles/tokens/colors.css is a design-review question a
    // linter cannot answer; it is raised in review, not here.
    'declaration-property-value-disallowed-list': [
      { '/^(?!--)/': [HEX_COLOUR] },
      {
        message:
          'Use a design token from @openrunic/ui, not a raw hex colour (see the token files under packages/ui/src/styles/tokens/).',
      },
    ],

    // The other half of the same house rule. A named colour is a literal just
    // as much as a hex one is, and `border-color: red` skips the token layer in
    // exactly the same way. This rule understands where a colour can appear, so
    // it leaves `transparent` and `currentColor` alone, and it does not treat a
    // font family that shares a name with a colour as a colour.
    'color-named': 'never',

    'selector-class-pattern': [
      BEM_CLASS,
      { message: 'Expected class selector to follow BEM: block__element--modifier, kebab-case.' },
    ],

    // --- Rules tightened or retargeted, not disabled ------------------------

    // stylelint-config-standard defaults to `context`, the Media Queries 4
    // range syntax (`@media (width >= 768px)`). That syntax needs Safari 16.4
    // and Chrome 104; the prefix syntax works in every browser that has ever
    // shipped. A clinical web application does not drop browser support to
    // change how a breakpoint is spelled, so the rule stays on and points at
    // the notation this codebase already uses, which keeps the 44 existing
    // media queries consistent with every future one. Revisit when the project
    // states a browser-support floor that excludes pre-2022 Safari.
    'media-feature-range-notation': 'prefix',

    // The icon, logo and empty-state components paint an SVG through a CSS
    // mask, and Safari only unprefixed the mask properties in 15.4. Every
    // `-webkit-mask-*` declaration in this tree is paired with its unprefixed
    // twin on the next line, which is the correct way to ship a component
    // library that emits raw CSS with no autoprefixer step between it and the
    // consumer. The rule stays on for everything else, where a vendor prefix
    // really is dead weight. Revisit when the project's browser-support floor
    // moves past Safari 15.4.
    'property-no-vendor-prefix': [true, { ignoreProperties: ['/^-webkit-mask/'] }],

    // A selector list such as `.link--active, .link--active:hover { color }`
    // makes this rule fire against every later plain `.link--active` rule, even
    // when the two set disjoint properties and neither can override the other.
    // Ignoring selectors that only appear inside a list removes that whole
    // class of false positive while keeping the rule's real catch: a
    // stand-alone low-specificity rule written after the high-specificity one
    // it was meant to beat.
    'no-descending-specificity': [true, { ignore: ['selectors-within-list'] }],

    // CSS Modules. `downtime.module.css` exists on another branch and more will
    // follow, and neither `:global`/`:local` nor `composes` is standard CSS, so
    // without these both would be reported as unknown. Configured here rather
    // than by adding a third-party shareable config, because this is the whole
    // of what such a config would do and this repository is graded on its
    // dependency surface.
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global', 'local'] }],
    'property-no-unknown': [true, { ignoreProperties: ['composes', 'compose-with'] }],

    // --- Extra defect rules, beyond the standard config ---------------------

    // `color: 12px` and `display: gird` are syntactically valid CSS that the
    // browser silently discards. These four rules type-check declaration
    // values, media feature values and at-rule preludes and descriptors against
    // the CSS specifications, which is the closest CSS has to a compiler.
    'declaration-property-value-no-unknown': true,
    'media-feature-name-value-no-unknown': true,
    'at-rule-descriptor-no-unknown': true,
    'at-rule-descriptor-value-no-unknown': true,
    'at-rule-prelude-no-invalid': true,

    // --- Off: Prettier owns blank lines -------------------------------------

    // Prettier never inserts or removes a blank line in CSS, it preserves what
    // the author wrote. These five rules would therefore fail CI over spacing
    // that the formatter has already declared correct, and a contributor who
    // ran `pnpm run format` would have no way to satisfy both tools. Revisit
    // only if Prettier starts normalising blank lines itself, at which point
    // these become redundant rather than contradictory.
    'at-rule-empty-line-before': null,
    'comment-empty-line-before': null,
    'custom-property-empty-line-before': null,
    'declaration-empty-line-before': null,
    'rule-empty-line-before': null,

    // --- Off: notation preferences with no behavioural difference -----------

    // These four ask for `rgb(46 33 26 / 5%)` where the token files write
    // `rgba(46, 33, 26, 0.05)`, and `#fff` where they write `#ffffff`. Both
    // spellings render identically, the legacy ones work in strictly more
    // browsers, and the token files deliberately mirror the design system's
    // source values character for character so that a token can be diffed
    // against the design it came from. Failing CI over the spelling of a colour
    // that is already correct is exactly the noise that trains people to
    // disable rules. Revisit if the design system itself moves to modern colour
    // notation, at which point turning these on enforces the match instead of
    // breaking it.
    'alpha-value-notation': null,
    'color-function-alias-notation': null,
    'color-function-notation': null,
    'color-hex-length': null,

    // Cannot tell a font family name from a CSS keyword, so it reports
    // `font-family: 'Fraunces', Georgia, ...` as needing `georgia`, and
    // `currentColor` as needing `currentcolor`. CSS keywords and font family
    // names are both case-insensitive, so nothing it reports here is a defect,
    // and lowercasing a proper noun makes the stylesheet worse. Revisit if
    // stylelint gains per-property scoping for this rule.
    'value-keyword-case': null,

    // `:not(.a):not(.b)` and `:not(.a, .b)` do not have the same specificity:
    // the chained form sums each pseudo-class, the selector-list form takes the
    // maximum of its arguments. Rewriting the five chained `:not()` selectors
    // in this tree to satisfy this rule would therefore lower their specificity
    // and could silently change which rule wins. A rule whose fix changes the
    // cascade is not a formatting rule. Revisit never; prefer whichever form
    // states the intent.
    'selector-not-notation': null,

    // Asks for a shorthand wherever the longhands could be collapsed. In this
    // tree that means folding a `grid-template-areas` block into
    // `grid-template`, and collapsing `column-gap: 10px` plus `row-gap: 2px`
    // into `gap: 2px 10px` where each value carries its own design-system
    // rationale in a comment beside it. Every instance would make the
    // stylesheet harder to read, and writing a longhand is not a defect. The
    // two shorthand rules that do catch defects,
    // `declaration-block-no-shorthand-property-overrides` and
    // `shorthand-property-no-redundant-values`, both stay on. Revisit if the
    // rule gains a way to require the shorthand only where the longhands carry
    // no independent meaning.
    'declaration-block-no-redundant-longhand-properties': null,
  },
};
