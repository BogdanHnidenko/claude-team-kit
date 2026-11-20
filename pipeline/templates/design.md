# Design: <feature title>

- **Task id:** <id>
- **Platforms:** web | mobile (iOS/Android) | both
- **Mockup:** `docs/design/<id>/mockup.html` (open it in a browser; it uses the real tokens)

## Summary
Two or three sentences: who uses it, what the screen must make them FEEL and DO (the one main action), and the visual idea in one line ("calm, dense table with one accent colour" / "friendly card layout with big numbers").
What was wrong with the old look (if it is a redesign): one or two concrete points.

## Tokens
Use existing tokens first. Table of what this design uses; mark NEW only when nothing fits, with the reason.
| Role | Token / value | Where used | New? |
|---|---|---|---|
| Primary action | `--color-primary` #2563EB | main button, links | no |
| Surface | … | cards | no |
Typography (family, size / line-height / weight per role), spacing scale used (4/8/12/16/24/32), radius, borders, shadows/elevation, icon set and sizes.

## Screens
One block per screen or component. Developers build from this, so be exact.
### <Screen name> (route / place)
- **Layout:** structure top to bottom (header, content, footer), grid and alignment, max widths, paddings, gaps (numbers, not "some space"). A small ASCII sketch is welcome.
- **Components:** each element → existing component name from the project (or NEW) → size, colour tokens, radius, font role.
- **Responsive (web):** what changes at 375 / 768 / 1280 (columns, hidden or collapsed parts, order). **Safe areas and keyboard (mobile):** what sits where.
- **Copy:** exact texts (microcopy) in all supported languages the task touches; tone.
- **`data-testid` / `testID`:** names from the spec; new ones listed here (the orchestrator adds them to the spec).

## States
For every interactive or data-driven element: default, hover / pressed, focus, disabled, loading (skeleton or spinner, where), success, validation error, server error, empty (with the message and the next step), long content (truncation rule), dark mode if the app has it.

## Motion
What animates, duration (ms), easing, and what does NOT animate. Reduced-motion behaviour. "None" is a valid answer.

## Accessibility
Contrast checked (numbers for the main text/background and button pairs), tap targets (≥ 44 pt / 48 dp, web ≥ 40 px), focus order and visible focus, labels for icon-only buttons, text scaling (large font does not break the layout).

## Visual acceptance
Concrete, checkable facts for the tester (looks at screenshots and measures). Numbered V-1, V-2 … The orchestrator copies them into the spec as acceptance criteria.
- V-1: The primary button on <screen> is 48 px high, radius 12 px, background #2563EB, white label 16/24 semibold.
- V-2: …

## Open points
Decisions you made without asking (ASSUMPTIONS), new dependencies or fonts (NEW_DEPENDENCY), anything the developer must ask the orchestrator about.
