# Liquid glass visual refresh for Wayfind

## Context

Wayfind's UI is flat: solid cards on one background colour, square-ish tabs, and plain popups. You want a liquid glass look on tabs, popups and the rest of the controls, with the same simplicity and no change in what the app does.

Decisions made:

- **Reach:** real blur on floating controls (header, tabs, popups, drawer). Cards are lightly translucent with a bright edge.
- **Header:** a floating capsule that stays put while content scrolls under it.
- **Background:** a soft, faint blue wash in both themes.
- **Depth:** frosted glass with light-catching rims, the same in every browser. No SVG refraction.

Layout, wording, routes, data and behaviour stay as they are, apart from the header changes listed under step 3. No new dependencies, and no new origins, so the CSP is unchanged.

## Traps this design must avoid

1. **A blurred header would break the Upgrade popup.** `backdrop-filter` makes an element the containing block for `position: fixed` children, and `UpgradeButton` renders its `Modal` inside `SiteHeader`. The popup would be trapped inside the capsule. So the blur goes on a `::before` layer, never on the element itself. This also lets glass tabs sit inside the glass header, because a backdrop filter on an ancestor would otherwise cut nested glass off from the page behind it. Never put a `transform` or `filter` on the header either.
2. **A `::before` layer scrolls away in a scrolling panel.** `Modal`'s panel has `overflow-y-auto`, so the dialog needs an outer glass panel that keeps `role="dialog"`, `panelRef` and focus, with an inner scrolling div.
3. **Blur shows nothing over a smooth gradient.** Cards get translucency and a rim, not `backdrop-filter`. That is what keeps a list of 25 packages fast on phones.
4. **A sticky header can hide keyboard focus.** Add `scroll-padding-top` on `html`.
5. **`background-attachment: fixed` misbehaves on iOS.** Use a fixed `body::before` layer for the wash.

## Implementation

Build on a new branch from `refactor/merge-duplicates-remove-dead-code`, because `main` doesn't have that work yet. Save this plan as `docs/liquid-glass-plan.md` in the first commit, since `CLAUDE.md` keeps plans in `docs/`. This is outside Phase 7, by your explicit request. Small commits, one per step.

### 1. Foundation: `src/app/globals.css`

All glass lives here once, as Tailwind `@utility` classes, so components stay simple:

- **Tokens** in `@theme`, with dark values in both dark blocks (`tests/theme-css.test.ts` fails if they drift): glass tint, strong tint, card tint, rim highlight, rim shadow, hover fill, and wash colours.
- **`glass`:** header, tab tracks and floating bars. `::before` holds blur, saturation and tint. A layered inset shadow draws the rim.
- **`glass-strong`:** popups and the drawer. Higher tint, so text stays readable over anything.
- **`glass-card`:** translucent card with a rim and a soft shadow, no blur. Replaces the repeated `rounded-lg border border-slate-200 bg-surface`.
- **`glass-pill`:** the selected tab. Replaces `bg-ink text-on-ink` on tabs.
- **`glass-scrim`:** the dimmed, lightly blurred layer behind popups.
- **`btn-soft`:** the secondary button, replacing `rounded-md border border-slate-300 ... hover:bg-slate-50`, which repeats across about eight components.
- **Wash:** `body::before`, fixed, behind everything, with no pointer events.
- **Fallbacks on the utilities themselves**, so tokens aren't duplicated: solid `--color-surface` under `@supports not (backdrop-filter: blur(1px))`, `prefers-reduced-transparency: reduce`, `prefers-contrast: more` and `forced-colors: active`. Motion is removed under `prefers-reduced-motion`.
- Write `-webkit-backdrop-filter` explicitly for Safari.

Extend `tests/theme-css.test.ts` to check that the fallbacks exist, no `.tsx` uses a `backdrop-*` class directly (this guards trap 1), and the old card class string is gone.

### 2. Popups: `src/components/modal.tsx`

- Split the panel per trap 2. Focus trapping, Escape, and return of focus stay as they are.
- Centre popup: `glass-strong`, large radius, short fade and scale in.
- Drawer: floats with a small margin on all sides instead of touching the edge, full width on phones.
- Round close button.

`SetupPrompt`, `ShipmentDrawer` and `UpgradeButton` inherit all of this.

### 3. Header and tabs

- `src/components/site-header.tsx`: sticky capsule, `max-w-3xl` to line up with the content, `z-40`. Setup and Settings become pill tabs, with `glass-pill` on the current one.
- `src/components/wordmark.tsx`: a `compact` prop drops the tagline in the header, because a two-line wordmark won't fit the capsule. It stays on sign-in. This is one of the visible text changes.
- One row from 375px up, tidying spacing on phones. Narrower screens wrap rather than clip, so no control is lost. The email truncates, with the full value in `title`.
- `src/components/view-toggle.tsx`: equal-width glass track with a pill that slides via CSS on `data-view`. It stays a server component, and `aria-current` is unchanged. The pill moves when the URL updates, so it may trail the tap slightly on a slow connection.
- `src/components/device-setup.tsx`: same track and pill, no slide, because its three tabs wrap. Keyboard and `role="tablist"` behaviour are unchanged.

### 4. Cards and buttons sweep

Mechanical replacement across about 14 files, for example `shipment-list.tsx`, `add-package-form.tsx`, `theme-switcher.tsx`, `push-device-manager.tsx`, `install-card.tsx` and `app/settings/page.tsx`.

- List rows: `hover:bg-slate-50` becomes the hover token, so a row doesn't flash opaque on translucent cards.
- Controls move to capsule radii. Primary buttons stay `bg-brand-600` / `bg-red-600` with white text, as `CLAUDE.md` requires.
- Warning cards (amber, red) keep their tints and gain the shared radius, because their colour carries meaning.
- `StatusChip` colours stay unchanged. `status-chip.test.tsx` checks them.

### 5. Remaining pages and the map

- `shipment-map.tsx`: match the map's radius and rim to the cards. Layout, markers and data are unchanged.
- Glass on MapLibre's attribution control through `globals.css`, keeping the OpenStreetMap credit legible.
- Sign-in, account-deleted, legal and admin pages pick up the wash and `glass-card` / `btn-soft` where they have cards or buttons.
- App icons and manifest stay as they are.

### 6. Docs

Update `CLAUDE.md`: the colour convention (cards use `glass-card`, secondary buttons `btn-soft`), the rule that blur lives only in `globals.css` on `::before`, and the reason for it.

## Verification

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, all green. Tests barely depend on class names, so failures here would be real.
- CI's e2e launch test passes. It also fails on any CSP violation.
- Screenshots of list, map, Setup, Settings, sign-in, drawer and popups, at 375px and 1280px, light and dark, in Chromium and WebKit via Playwright, using the fake providers. Attach them to the summary for your review.
- Specific checks:
  - The Upgrade popup covers the whole viewport (trap 1).
  - A long drawer scrolls and its glass stays in place (trap 2).
  - Tabbing to a control never leaves it under the header (trap 4).
  - No overlap or clipping at 320px.
- Text contrast of at least 4.5:1, measured on the glass with busy content scrolled beneath it, in both themes.
- Emulate `prefers-reduced-transparency`, `prefers-contrast: more`, `forced-colors` and `prefers-reduced-motion`, and confirm the solid fallbacks and no animation.
- Scroll a 25-package list under 4× CPU throttling and confirm it stays smooth.
- **Needs you:** check it on a real iPhone, in Safari and as the installed app. WebKit in Playwright is close, but not the same as a real device.
