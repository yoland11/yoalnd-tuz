# AJN Global Button and Icon System

## Intent

Use the existing `/admin/workspace` screen as the visual reference for buttons and icons across the AJN site. Apply the system to administration, staff, booking, storefront, and customer-facing interfaces while preserving each control's current action, permission checks, loading state, navigation, and validation.

The reference uses coral primary actions, white secondary controls with quiet borders, rounded corners, restrained shadows, and Lucide line icons. Prominent module icons sit in soft, context-colored halos. Small inline icons remain unframed so tables, forms, and compact toolbars stay readable.

## Current implementation

- The project already uses Lucide for its application icons; no second icon library was found in the inspected source tree.
- The shared `src/components/ui/button.tsx` component is used across about 158 source files.
- Raw `<button>` elements appear across about 126 source files, in addition to shared buttons.
- `src/views/admin/workspace.tsx` defines the reference module-card palette and icon halo composition locally.
- `src/index.css` contains targeted styling for specialized tools, including a dark bouquet designer. A universal `button`/`svg` override could damage these controls and other embedded interactions.

## Design contract

### Buttons

- Primary actions use the AJN coral token, white text, rounded-xl geometry, and a restrained elevation consistent with the workspace's main action.
- Secondary actions use a light card surface, subtle border, and foreground text.
- Quiet actions use a transparent surface and a neutral hover state.
- Destructive, warning, success, and selected states keep their semantic status colors; status must not be inferred from shape or motion alone.
- Keep clear focus, hover, pressed, disabled, and loading states. Retain the current keyboard behavior and the minimum touch target on mobile.
- Icon-only buttons must expose an accessible name and retain a large enough hit target even when their visible glyph is small.
- Button size remains contextual: compact desktop toolbar actions, standard actions, and prominent page actions use named shared sizes. Mobile controls retain a touch-friendly target.

### Icons

- Continue using Lucide; normalize stroke appearance and color inheritance rather than replacing the icon set.
- Standardize semantic roles for action, control, and prominent section icons while retaining contextual dimensions for charts, diagrams, and product previews.
- Use `currentColor` so icon color follows its control's hover, selected, disabled, and semantic state.
- Use soft color halos for prominent module or section icons, following the workspace's category palette. Do not wrap every inline table, input, status, or navigation glyph in a circle.
- Keep success, warning, destructive, and informational icon colors meaningful and consistent.

### Layout and themes

- Apply shared control styles in RTL and LTR interfaces and at desktop, tablet, and mobile breakpoints.
- Preserve specialized page surfaces and content layouts. The migration changes control and icon presentation, not page composition.
- Keep specialized canvases and editors, such as the bouquet designer, compatible with their existing surface theme while using the shared semantic variants and accessible interaction states.

## Implementation approach

1. Extend the shared Button design tokens and variants to match the workspace reference without changing button behavior or component call sites.
2. Add small reusable primitives for icon-only actions and prominent icon containers, with documented sizes, accessible labels, and semantic tones.
3. Move the workspace's reusable icon-card treatment to those primitives so it remains the source example rather than a one-off style.
4. Audit and migrate application-level raw button styles in stages across the full site. Use the shared primitives where they fit; retain specialized internal controls only when they need a distinct interaction, while matching the shared focus, disabled, and icon rules.
5. Search for remaining divergent control/icon patterns and record any intentional exceptions in code comments or the design-system documentation.

Do not apply broad element-level CSS that overrides every `button` or `svg`; form steppers, tab selectors, chart controls, canvases, and embedded design tools use different behaviors and need deliberate migration.

## Boundaries

In scope:

- Shared Button variants and icon-only actions.
- Application buttons and Lucide icons in admin, staff, booking, storefront, service, account, and customer-facing routes.
- Navigation and workspace module shortcut icons where they are part of the AJN interface.
- RTL/LTR and responsive visual states.

Out of scope:

- Changing any action, route, permission, API, booking, purchase, sales, payment, inventory, or accounting behavior.
- Replacing Lucide or changing product photography, logos, charts, or illustration artwork.
- Restyling non-interactive statuses as buttons or removing their semantic colors.
- Changing third-party widget internals or browser-native control rendering that the app does not own.

## Verification

- Add focused regression checks for the shared variants, icon-only accessible naming, and representative raw-button migrations.
- Run `pnpm run typecheck`, `pnpm run build`, and `pnpm run verify:critical` after implementation, as required for shared UI components.
- Review representative administration, staff, booking, store, and account routes at desktop and mobile sizes, including RTL and any existing LTR content.
- Check primary, secondary, quiet, destructive, selected, focus, disabled, and loading states.
- Confirm that all audited application-level raw buttons either use the shared system or have an explicit documented exception.
- Database save smoke tests are not part of this presentation-only change; do not add schema or mutate production data.

## Self-review

- Scope includes all application surfaces selected by the user, including store and booking routes.
- Button semantics and icon meanings remain intact; only their presentation is standardized.
- Semantic status colors, specialized editor surfaces, and compact inline icons are explicitly addressed to avoid a blanket style regression.
- The verification criteria cover responsive behavior, accessibility states, and the project's required critical gates.
