# DESIGN.md

The app (`polish-theme.css`) is the source of truth. The brand site inherits from it so the two surfaces cannot drift.

## Color

Strategy: **Restrained.** Tinted near-neutrals carry the surface, one accent stays under 10%.

Neutrals are tinted toward blue (hue ~265), never pure grey. `#000` and `#fff` are banned; the darkest surface is `#0a0c10` and the lightest text is `#f0f2f6`.

| Token | Hex | OKLCH | Role |
|---|---|---|---|
| `--ink-900` | `#0a0c10` | `oklch(0.145 0.012 265)` | Page canvas |
| `--ink-850` | `#12151c` | `oklch(0.185 0.013 265)` | Raised surface |
| `--ink-800` | `#1a1f2a` | `oklch(0.225 0.014 265)` | Inset / pressed |
| `--ink-700` | `#252b38` | `oklch(0.285 0.016 265)` | Borders, hairlines |
| `--text-1` | `#f0f2f6` | `oklch(0.955 0.004 258)` | Primary text |
| `--text-2` | `#a7b0be` | `oklch(0.755 0.018 258)` | Body copy. 8.7:1 on canvas |
| `--text-3` | `#6b7585` | `oklch(0.565 0.024 258)` | Faint. 4.0:1, so **large or decorative text only, never body** |
| `--volt` | `#e8ff00` | `oklch(0.945 0.229 118)` | The accent |

### The yellow budget

`--volt` is permitted on exactly four things:

1. The primary call to action.
2. Live numerals: the running clock, the score.
3. The active marker on the timeline rail.
4. Focus rings.

Everything else is neutral. A yellow heading, a yellow icon, or a yellow border is a bug.

### Event colors

Carried over from the app, used **only** as 6px dots in an event log, where they are semantic rather than decorative. Never as surface, text, or border color.

`--ev-goal #00e87a` · `--ev-save #7b5cfa` · `--ev-shot #00d4ff` · `--ev-card #ffc700` · `--ev-red #ff3b3b`

## Typography

Both families already ship in the app, so the site adds no new font requests.

- **Display: Bebas Neue.** Condensed, uppercase only, single weight. Reserved for the hero and section titles at 40px and above, with `-0.01em` tracking. Bebas below 32px reads cheap; do not use it there.
- **Text: Manrope**, 400 / 500 / 600 / 700 / 800. Everything that is not a display heading.

Rules:

- All numerals use `font-variant-numeric: tabular-nums`. A clock that reflows while ticking is a defect.
- Body line-height `1.65`. Light text on dark reads lighter than it measures and needs the extra room.
- Measure capped at `68ch`.
- Scale is fluid `clamp()`, ratio ≥ 1.25 between steps.
- Uppercase is for the display face and short labels only. Never for body copy.

## Layout

A two-column shell on desktop: a fixed-width timeline rail, then content.

```
grid-template-columns: 92px minmax(0, 1fr)   /* ≥1024px */
grid-template-columns: 1fr                    /* below: rail collapses inline */
```

Content is **left-aligned**, not centered. Feature sections alternate text/image sides and deliberately vary in height. Screenshots may bleed past the content edge toward the viewport.

Spacing is a 4px rhythm: `4 8 12 16 24 32 48 64 96 128`. Section separation varies on purpose; uniform padding everywhere is monotony.

Radii inherit from the app: `6px` / `10px` / `14px`.

## The timeline rail

The site's one structural signature. A hairline down the left with match timestamps (`00:00`, `04:15`, `12:30`, `HT`, `38:00`, `51:20`, `FT`) marking each section.

- Passed markers: `--text-2`. Active marker: `--volt` with a filled dot. Upcoming: `--text-3`.
- Driven by `IntersectionObserver`, never by a scroll listener.
- Below 1024px it collapses to a single inline timestamp above each section heading.

This is a deliberate, named system tied to the product. It is the *only* place repeating small labels are allowed; do not add tracked uppercase kickers anywhere else.

## Motion

- Transform and opacity only. Never animate layout properties.
- Ease out with exponential curves: `cubic-bezier(0.16, 1, 0.3, 1)`. No bounce, no elastic.
- 150–300ms for micro-interactions, up to 500ms for section reveals.
- One orchestrated hero reveal, staggered. Scroll reveals are a single fade-and-rise, fired once.
- The hero clock ticks. Under `prefers-reduced-motion` it renders a static time and all reveals resolve instantly.

## Bans

On top of the shared design laws:

- No side-stripe borders (`border-left` as a colored accent).
- No gradient text, no `background-clip: text`.
- No glassmorphism.
- No hero-metric block: big number, small label, supporting stats.
- No grid of identically-sized icon-heading-paragraph cards.
- No emoji as icons. Inline SVG, single stroke width, `currentColor`.
- No em dashes in copy.
- No invented social proof: no testimonials, club logos, or user counts we do not have.
