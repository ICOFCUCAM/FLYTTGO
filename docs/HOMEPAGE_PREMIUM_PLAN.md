# /preview/home premiumization plan: 60 commits (owner, 31 October 2026)

This plan comes from a full-page visual review of `/preview/home` after #22: every section was screenshotted at 1440 px and the phone layout was checked at 390 px.

**Scope:**
- Visual refinement of the existing page only: same architecture, same sections, same journeys.
- No new claims; example data stays labelled.
- The production homepage is untouched.

**Process:**
- One focused change per commit, pushed after every 20 commits.
- Each commit is built and its section checked in the browser.
- Each push follows a full check: `scripts/platform-home/visual-check.cjs`, typecheck and tests.

**What the review found:**
- **Strong:** the hero card over the photograph; the deep-blue workspace stage; the finance explorer; the closing journeys.
- **Inconsistent between sections:** label sizes, section spacing (seven values), link and button styles.
- **Weak at the seams:**
  - the hero to booking hand-off;
  - the moving chapter, which reads as four separate blocks;
  - the providers band, mostly empty space;
  - the studio, whose long settings column leaves the storefront short.
- **Small or crowded texts:** the participants band, the capability statuses, the studio legend, the corporate checklist.
- **Phones:** the marketplace becomes a very long stack, and some tab rows overflow without a cue.

## A · Foundations (1–8)
1. This plan.
2. Labels: one size and tracking for every eyebrow and kicker, at least 12 px.
3. Section heads: one measure for headings and intros across the page.
4. Rhythm: one section spacing for every chapter.
5. Hairlines: one warm line colour and weight on frames, cards and rules.
6. Focus: a visible ring on light and dark grounds.
7. Links: one underline style with an arrow nudge.
8. Buttons: one size scale and consistent arrows.

## B · Hero and booking (9–16)
9. Hero card: paddings, a signature line with a gold rule, the proposition's measure.
10. Participants band: readable size, separators.
11. Journey band: numerals and hover.
12. Slideshow: segmented progress instead of dots.
13. Hero on phones: spacing, full-width actions and picture height.
14. Booking promise: display line with the accent serif.
15. Booking frame: border, shadow, header.
16. Hero to booking: the booking promise starts on the hero card's edge and the widget takes the rest of the width. Overlapping the hero was rejected: the widget would cover the journeys band.

## C · Journeys and marketplace (17–24)
17. Journeys heading measure.
18. Journey cards: large numerals and hover.
19. For Organisations: its three options as clear links.
20. Marketplace categories as a rail that scrolls on phones.
21. Marketplace cards: caption hierarchy.
22. Marketplace hover and focus.
23. Marketplace on phones: a swipeable row instead of a long stack.
24. Related-link rows: one compact style.

## D · Moving chapter (25–31)
25. Feature service: caption over the picture.
26. Service list: index numbers and hover.
27. Booking steps: larger numerals on the gold line.
28. Van cards: specification layout and picture ratio.
29. Booking guarantees: numbered two-column list.
30. One chapter: the four moving sections share a ground and a chapter label.
31. Moving chapter on phones.

## E · Business and financial workspaces (32–40)
32. Workspace title bar: breadcrumb and example tag.
33. Workspace sidebar: active state and example counts.
34. Workspace metrics: label, value and note hierarchy.
35. Workspace table: row hover and aligned status.
36. Workspace navigation on phones: a scroller with an edge cue.
37. Finance lifecycle strip: connected steps.
38. Transaction explorer: a progress line to the current step.
39. Finance document: paper styling and total emphasis.
40. Finance notes and principles: layout.

## F · Platform story (41–48)
41. Industry booking form: realistic inputs and flow chips.
42. Industry selector on phones: a scroller.
43. Shared core diagram: connectors and pillar hover.
44. How it works: lifecycle numerals and capability statuses aligned.
45. One business's path: numbered steps.
46. Corporate: dashboard rows and checklist.
47. Providers: benefits as a numbered grid, a stronger action.
48. Trust: tier columns and tabs.

## G · Studio and closing (49–54)
49. Studio: the storefront stays in view while the settings scroll.
50. Storefront: a search field and a provider row (illustration).
51. Studio settings in labelled groups.
52. Closing: each journey with a line of explanation.
53. Closing to footer: hairline and spacing.
54. Closing on phones.

## H · Whole page (55–60)
55. Motion: staggered card entrances.
56. Motion parity: off and reduced motion show everything.
57. Dark grounds: contrast pass.
58. Phones: pass over every section at 390 px.
59. Tablets: pass at 820 px.
60. Documentation, decision log and the check script updated.

If work remains after commit 60, the plan continues with further commits, numbered from 61.
