# Designing the page

The look comes last and follows the client. None of what follows is a checklist; use your own judgement about what this client needs, and if a tool does not help on this build, skip it.

## The bar for craft

The design canvas "Client Health Page" (https://claude.ai/artifact/HVQWa5JQ2e4QkgSwwApat2, private; ask the account owner to share it if you cannot open it, and use the two boards in the repo's `docs/images/` meanwhile) holds the reference boards: how the skill thinks, the panel library, and four worked builds, each with the plan that produced it and its pages. Example A (the food tour bookings build) is the bar: its summary, its dense detail layer, its one-workflow page and its Health cards. Match that level of care, not its content or its colours. Examples B, C and D show the same thinking producing very different pages in three other design systems.

## Tools, in the order they usually help

- **The client's design system.** Read `.interface-design/system.md`, `DESIGN.md`, the Tailwind config, `globals.css` or whatever the repo uses, and build with its tokens, type and radii. Never introduce a second look.
- **Mobbin** (`mcp__mobbin__search_screens`, `search_flows`). Pull five to ten real screens for any panel you are unsure of, such as run logs, alert queues, analytics summaries or role switchers, before drawing it.
- **The shadcn admin kit**, if it is on the machine (a licensed premium kit; ask the account owner where it is, and skip it if you do not have it). The developers screens are the closest match for the detail layer: `src/app/(admin)/developers/(devtools)/events-&-logs` (facet filters beside a log table) and `overview` (request and response-time charts). `src/components/payment-processor` and `ecommerce` hold many dashboard, list and detail variants. Borrow structure and patterns into the client's own components.
- **The shadcn MCP** (`mcp__shadcn-ui__*`), for blocks and components when the client uses shadcn/ui and the kit is not on the machine.
- **Impeccable**, for a critique and polish pass on the built page: hierarchy, spacing, empty and error states, phone width.
- **Perception-first design**, to check the summary reads in five seconds for the least technical role, and that nothing on it needs explaining.

## Things that matter on every page

- Plain language on the summary. Raw names, ids, percentiles and event names live behind a developer switch on the detail layer.
- Empty, stale, erroring and absent states designed on purpose, per the plan's step 6.
- WCAG AA contrast, visible focus, real buttons and links, `prefers-reduced-motion`.
- Phone width for any role the plan says lives on a phone; wide tables scroll inside their own box.
- Times in the client's zone, money in the client's currency.
