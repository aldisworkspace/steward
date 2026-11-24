---
name: Steward
description: The reviewer's desk for nonprofit billing packages; ink on paper, colour only for state.
colors:
  paper: "#efece6"
  paper-2: "#e6e2da"
  sheet: "#ffffff"
  ink: "#17150f"
  ink-2: "#5c574e"
  ink-3: "#8a847a"
  rule: "#ddd8cf"
  rule-strong: "#c4bdb1"
  green: "#0e7c5a"
  green-ink: "#0b6649"
  green-tint: "#e2f0e8"
  amber: "#c98a1b"
  amber-ink: "#85520a"
  amber-tint: "#f8ecd6"
  redpen: "#e0433a"
  redpen-ink: "#b0281f"
  redpen-tint: "#fbe6e3"
typography:
  display:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "40px"
    fontWeight: 400
    lineHeight: "44px"
  headline:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "28px"
    fontWeight: 400
    lineHeight: "32px"
  section-title:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: "26px"
    letterSpacing: "-0.01em"
  quote:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "1.375"
  money-focal:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "56px"
    fontWeight: 500
    lineHeight: "58px"
    letterSpacing: "-0.025em"
    fontFeature: "tnum, lnum"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: "24px"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  body-sm:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  micro:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: "14px"
rounded:
  sm: "6px"
  md: "10px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
  "16": "64px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "#2c2920"
  button-primary-disabled:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink-2}"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.paper}"
  button-ghost:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
  button-ghost-hover:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.redpen-ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
  button-danger-hover:
    backgroundColor: "{colors.redpen-tint}"
  card-sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.md}"
    padding: "24px"
  badge-neutral:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  badge-green:
    backgroundColor: "{colors.green-tint}"
    textColor: "{colors.green-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  badge-amber:
    backgroundColor: "{colors.amber-tint}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  badge-red:
    backgroundColor: "{colors.redpen-tint}"
    textColor: "{colors.redpen-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  progress-track:
    backgroundColor: "{colors.paper-2}"
    rounded: "{rounded.pill}"
    height: "4px"
---

# Design System: Steward

Scope: the authenticated app at `/app` (Packages, Package, Review, Data). The landing page (`app/page.tsx`, `app/components/landing/**`) has its own styles and is not governed here, except that both share Geist.

## Overview

**Creative North Star: "The Reviewer's Desk"**

One white sheet per billing package on a warm bone desk. Everything clean stays ink on paper; exceptions are marked the way a senior accountant marks them, in red pen. The reviewer should be able to look only at what needs them, and the surface earns that by staying quiet everywhere else.

The working surfaces (tables, the review queue, forms) are plain grotesk and standard controls. The paper-and-serif voice is held to display moments: one Newsreader sentence per screen, section titles, and verbatim contract quotes. Density is calm but not sparse: hairline rules separate sections inside a sheet instead of nested boxes.

Rejected: the KPI-tile dashboard with charts and coloured cards.

**Key Characteristics:**
- Bone ground, white sheets, near-black ink, warm hairline rules.
- Colour appears only as state, never as decoration.
- Geist for all UI and every number; Newsreader only for display lines and quotes.
- One focal money figure per screen, dollars large, cents small.
- Two signature moves: the red-pen strike and the SIGNED rubber stamp.

## Colors

A neutral paper-and-ink palette with three state colours, each in a stroke / ink / tint triad.

### Neutral
- **Bone Paper** (paper): the page ground behind every sheet; also the sticky top bar at 95% with a light blur.
- **Worn Paper** (paper-2): the second neutral layer: hover fills, selected rows, wells, progress tracks, skeletons, disabled primary buttons.
- **Working Sheet** (sheet): the white card that holds a package, a case, a data table.
- **Desk Ink** (ink): primary text, primary buttons, the in-progress bar, focus rings.
- **Faded Ink** (ink-2): secondary text and labels (6.1:1 on sheet, 5.4:1 on paper); the italic accent in display lines.
- **Pencil Grey** (ink-3): non-text only: icons, neutral dots, disabled strokes. Never body text.
- **Hairline** (rule) and **Firm Hairline** (rule-strong): section dividers inside sheets and card borders; rule-strong for control outlines and hover borders.

### State
- **Ledger Green** (green / green-ink / green-tint): passes, ready, signed. The progress bar turns green only when every check passes.
- **Needs-You Amber** (amber / amber-ink / amber-tint): something waits on a person: review counts, running status, text selection.
- **Red Pen** (redpen / redpen-ink / redpen-tint): not allowed, caught, overdue, failing. The strike stroke uses redpen; text uses redpen-ink.

### Named Rules
**The Colour Is State Rule.** Colour only ever means state: redpen = not allowed / caught, amber = needs you, green = passes / ready. Everything else is paper and ink. A coloured element with no state behind it is a bug.

**The Word Too Rule.** State is never carried by colour alone; every badge and dot sits beside a word that says the state.

**The Ink-For-Text Rule.** On tints, text uses the -ink step (green-ink, amber-ink, redpen-ink); the bright stroke step is for dots, bars and the pen line.

## Typography

**Display Font:** Newsreader 400/500, normal and italic (Georgia fallback)
**UI and Numbers Font:** Geist (ui-sans-serif, system-ui fallback)

**Character:** A working grotesk with a literary serif reserved for moments. Geist is shared with the landing page, so product and site read as one family, and its tabular figures are strong enough to carry every amount.

### Hierarchy
- **Display** (Newsreader 400, 28px/32px on mobile, 40px/44px from sm): the one sentence that opens a screen ("2 packages need you *before Nov 30*."), balanced wrap.
- **Section Title** (Newsreader 400, 20px/26px, -0.01em): section heads inside a sheet, with an optional italic accent.
- **Quote** (Newsreader 400, 16px, snug): verbatim contract clauses, in curly quotes, citation below in label size.
- **Money, focal** (Geist 500, 40px to 56px, -0.025em, tabular): the single claimable amount on a package or case; cents at 0.55em, raised, in ink-2.
- **Title** (Geist 500, 16px/24px; 20px for a case's vendor): package names, row titles.
- **Body** (Geist 400, 14px/20px): default UI text; prose capped at 64 to 68ch.
- **Body small** (Geist 400, 13px/18px): table cells, meta lines.
- **Label** (Geist 500, 12px/16px, ink-2, sentence case): field and section labels ("Claimable", "What we found").
- **Micro** (Geist 500, 11px/14px): data-source pills, counts, keyboard hints.

UI steps run at a ratio of about 1.15 (11, 12, 13, 14, 16, 20); display steps (28, 40, 56) are larger jumps.

### Named Rules
**The Serif For Moments Rule.** Newsreader appears only in display lines, section titles, the wordmark, and verbatim contract quotes. Tables, queues, forms, buttons and money are always Geist.

**The Italic Accent Rule.** A display line carries at most one italic phrase, set in ink-2, and it is the qualifier ("*and filed*", "*Nothing needs you.*"), never the subject.

**The Tabular Money Rule.** Every amount renders from integer cents through the Money component with tabular, lining figures, right-aligned in tables. Negative uses a true minus or parentheses.

## Layout

- **Spacing:** 4px base. Rhythm steps in use: 4, 8, 12, 16, 24, 32, 48, 64. Sheet padding is 20px on mobile and 24 to 32px from sm.
- **Containers:** top bar and app frame max 1360px; Packages list max 1040px; centred.
- **Sheets:** one sheet per package or case; sections inside it are divided by hairline top borders, never nested cards.
- **Package header:** Z-pattern. Who and what top-left, the one number top-right, state on a ruled row below.
- **Review:** from lg, a two-pane grid (queue 320 to 400px, case fills the rest) at viewport height with each pane scrolling. Below lg, Review is a list; opening an item shows the case full-screen (fixed, sheet background) with a sticky back bar.
- **Top bar:** sticky from lg (64px tall); below lg it wraps, and the nav becomes a full-width row of equal tabs.

### Named Rules
**The 375 Rule.** Nothing scrolls the page horizontally at 375px. Wide tables scroll inside their own frame (Table `minWidth`), never the page.

**The 44 Rule.** Every tap target is at least 44px tall below sm; desktop may drop to 32 to 40px.

## Elevation & Depth

Nearly flat. Depth comes from the tonal step between bone paper and white sheet plus a hairline border; shadows are a whisper at rest and lift only on interaction or for overlays.

### Shadow Vocabulary
- **Sheet** (`0 1px 2px rgb(23 21 15 / 0.05), 0 0 0 1px rgb(23 21 15 / 0.02)`): every resting card.
- **Float** (`0 16px 40px -12px rgb(23 21 15 / 0.22), 0 2px 6px rgb(23 21 15 / 0.06)`): hovered package cards, palettes, popovers.

### Named Rules
**The Two Shadows Rule.** Only sheet and float exist. Print drops both.

## Shapes

- **Small** (6px): inputs, chips, table wells, skeleton bars.
- **Medium** (10px): sheets and cards.
- **Pill** (999px): every button, badge, select, and the progress bar.
- Borders are 1px hairlines in warm rule colours. The rubber stamp is the only square-ish (4px), double-ruled shape.

## Components

### Buttons
Black pills, quiet outlines.
- **Shape:** pill. Height 40px (md) / 32px (sm) from sm; 44px minimum below sm.
- **Primary:** ink fill, white text; hover warms to #2c2920, active to black; disabled turns to paper-2 with ink-2 text.
- **Secondary:** white with a rule-strong outline; hover darkens the outline to ink-2 over paper.
- **Ghost:** ink-2 text, paper-2 fill on hover.
- **Danger:** white with a redpen-ink outline and text, redpen-tint on hover. Reserved for irreversible steps (reopen, reject).
- **Busy:** label swaps to a quiet "Working…" and the button disables to block double submits.
- **Transition:** background, border and colour at 150ms ease-out. Focus is the global 2px ink outline, offset 2px.

### Badges
State words in a pill: label type, a 6px dot plus the word. Tones: neutral, green, amber, red, ink (inverted; defined but unused in shipped views). Data-source pills ("Synthetic demo data") are outline-only in micro type.

### Cards / Sheets
- **Corner:** 10px. **Background:** sheet. **Border:** 1px rule. **Shadow:** sheet; package cards lift to float with a rule-strong border on hover.
- Never nest one sheet inside another. The whole package card is one link target.

### Progress Bar
4px pill track in paper-2. The fill is ink until complete and turns green only when every check passes; always paired with the text "5 of 7 checks pass". Width animates at 300ms ease-out.

### Tables (Ledger)
Hairline rows (rule), header in label type and ink-2, body in body-small, first and last cells flush with the sheet padding. Labels left, money right in tabular figures, no wrapping on amounts.

### Navigation
Three text tabs (Packages, Review, Data). Active is ink and medium weight with an underline indicator; inactive is ink-2. The Review tab carries an amber count pill. Run status sits right as a dot and a word (amber pulsing while running, redpen on error, green when up to date).

### Case File
A single sheet per transaction: header with date and IDs, the vendor title, and the focal amount; then "What we found" (a Newsreader sentence, redpen-ink when blocked); then "Books say / Steward says" with the red-pen strike; then collapsible evidence in three columns (contract quote, receipt, ledger).

### Signature: Red-Pen Strike
A hand-drawn redpen stroke (2.2px, round caps) drawn through the bookkeeper's wrong coding. It is a background on an inline span with box-decoration-break: clone, so every wrapped line gets its own stroke. The struck text drops to ink-2 and screen readers hear "Struck out:". The correct coding follows in green-ink. Draws once, left to right (460ms ease-out, 160ms delay).

### Signature: Rubber Stamp
"SIGNED" with "name · date" lands under the package total when the reviewer signs (in flow, never over text): green-ink (redpen-ink for a rejected case), double-ruled border, rotated -7deg, slight ink-texture displacement, 88% opacity. Drops once (260ms ease-out, from 1.35x scale) only in the session it was signed; otherwise it is static.

### Motion
- State transitions 150 to 250ms, ease-out (`cubic-bezier(0.22, 1, 0.36, 1)`). Panels slide in 16px over 220ms; toasts rise 6px over 200ms.
- The strike and the stamp play once and never loop. The only loop is the running-status dot pulse.
- Reduced motion: every animation is removed and transitions drop to 0ms; the strike and stamp render in their final state.

### Print
The package prints as the funder's document: US Letter, 0.6in by 0.55in margins, white ground, 11px base and 10px tables. The top bar, nav and anything marked no-print are hidden; sheets lose shadow, border and padding; table headers repeat per page and rows never split. Print-only blocks (such as the signature block) appear only on paper.

## Do's and Don'ts

### Do:
- **Do** keep clean lines ink on paper and spend colour only on state (redpen, amber, green).
- **Do** say every state in words next to its colour.
- **Do** open each screen with one Newsreader sentence, at most one italic accent in ink-2.
- **Do** render every amount through Money, tabular, from integer cents; one focal amount per screen.
- **Do** keep tap targets at 44px below sm and let wide tables scroll inside their own frame at 375px.
- **Do** play the strike and the stamp once, and respect reduced motion.

### Don't:
- **Don't** use gradients.
- **Don't** use emoji.
- **Don't** use AI sparkle icons or "magic" decoration for Steward's work.
- **Don't** put kicker or eyebrow labels (small uppercase tracked text) above headings; labels are sentence case.
- **Don't** use coloured side borders to flag rows or cards.
- **Don't** build KPI tiles, charts or coloured cards.
- **Don't** set tables, forms, buttons or money in Newsreader.
- **Don't** nest a sheet inside a sheet, or add shadows beyond sheet and float.
