# Salon Platform — UI/UX Design Brief

**A "fun, vibrant, colourful" makeover that stays clean, professional and trustworthy.**

Audience: the frontend team. Every hex, ratio, file path and API in this document was
verified against the code at time of writing, not assumed. Contrast figures are computed
(WCAG 2.1 relative luminance), not estimated. Where something is a judgement call it says so.

---

## 0. Read this first

### 0.1 The uncomfortable part

Three of the four screens you asked me to redesign **cannot be built as described without
server work first.** This is not a paint job. If the team plans it as one, it will fail in
sprint two.

| What was asked                                | What the code says                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Real cost                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| "The Stylist Dashboard"                       | A stylist **cannot open `/desk` at all**. `policy.ts:78` — `'appointment.viewAny': row(A, A, A, N, N)` against role order `[OWNER, MANAGER, FRONT_DESK, STYLIST, ASSISTANT]`. `desk/page.tsx:30` gates on exactly that. The nav drops links whose permission fails (`layout.tsx:52-56`), so a stylist silently loses _Today_ and _Diary_. `appointment.viewOwn` is granted to every role and used by **zero** routes.                                                                                                                                                                                                                                                                                                                   | New route + new service query + policy work. ~1.5 wks. Not UI.                 |
| "Smooth drag-and-drop calendar"               | **The permission exists; the implementation does not.** `policy.ts:88` already grants `'appointment.reschedule': row(A, A, A, O, N)` and `:91` `'appointment.forceSlot': row(AR, AR, AR, OR, N)`, and `Appointment.version` exists for it — but no service, action, route or test implements either. The complete set is `checkIn / startChair / endChair / markProcessing / markNoShow / checkOut` (`actions/appointment.ts`) and `hold / confirm / cancel` (`actions/booking.ts`). Nothing moves an appointment. And an appointment is not a block — `domain/scheduling/chain.ts` builds a `PhaseChain` of up to six typed segments (`BUFFER_BEFORE, ACTIVE, PROCESSING, RINSE, BUFFER_AFTER, BLOCK`), frozen onto the approved plan. | Server-side reschedule + chain revalidation is the bulk of it. ~3–4 wks total. |
| "Before/after photo galleries"                | `AppointmentPhoto` with kinds `BEFORE / PROGRESS / AFTER` **was deliberately deleted** in migration `20260806050000_drop_unused_models`. Today's `ConsultationPhoto` carries a `PhotoView` angle (FRONT/ROOTS/MIDS/…) but no pairing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Schema restoration first. ~1 wk before any UI.                                 |
| "Clean, frictionless checkout and tip screen" | The only genuinely UI-shaped ask. Tip is a bare `<input type="number">` at `till.tsx:460`. The server side is complete and correct — `tipCents`, never taxed, never discounted, tracked per payment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Pure frontend. ~1 wk. Do this first.                                           |

**Sequencing consequence:** ship the POS, then the client record, then the dashboard, then
the calendar. That is the reverse of how exciting they sound and the right order by
dependency and payoff.

### 0.2 The other uncomfortable part

The existing design is **not** the bland enterprise grey you might be picturing. It is a
deliberate, documented, contrast-tested system with a real point of view: blue is action,
gold is money and status, rose is the hair itself. `globals.css` argues its own case in
prose. `tests/unit/design/palette.test.ts` parses that file off disk and fails the build if
anyone nudges a colour to "look nicer".

So the honest diagnosis is not "this is ugly and needs new colours." It is:

1. **Colour that already exists is being thrown away at render time.** `StylistProfile.colorHex`
   (`tenancy.prisma:367`) and `ServiceCategory.colorHex` (`catalog.prisma:53`) are both stored,
   both queried — `daySchedule` selects `colorHex` at `front-desk.ts:460` — and rendered in
   **zero** `.tsx` files. Every calendar block is blue or gold regardless of who owns it. This
   is the single cheapest, most semantic route to "vibrant" in the whole product.
2. **The interactions are dead, not the palette.** The calendar is a pure Server Component
   with no client-side behaviour whatsoever. Nothing drags, nothing animates, nothing
   responds. That is what makes it feel flat — not the hues.
3. **The screens have IA problems, not styling problems.** The client record is twelve
   flat stacked sections in one scroll with deposits and cancellation fees _above_ consent
   and strand tests — and **colour formulas do not appear on it at all** (they live only on
   `desk/appointment/[id]`). A colourist cannot see a client's colour history from the
   client's own page.

Chasing "vibrant" by resaturating the chrome would spend the budget on the one thing that
is already working and leave all three real problems in place.

### 0.3 What this brief actually recommends

> **Quiet chrome, vivid content.** The nav, cards, tables and forms stay calm and get
> _better_, not louder. Colour is promoted hard into the places where it carries meaning —
> stylist identity, service category, appointment state, hair shade, photos. Delight comes
> from motion and responsiveness, not pigment on structural surfaces.

This satisfies "fun, vibrant and colourful" honestly: a diary where eight columns each carry
their stylist's colour, service categories are colour-coded, blocks lift and snap under your
hand, and the till celebrates a closed sale, reads as _far_ more alive than the current
build — while a receptionist can still stare at it for eight hours.

### 0.4 Bugs found while auditing (see Appendix A for detail)

- **Calendar time gutter is broken.** Hour labels drift quadratically out of alignment with
  the hour rules — measured in Chromium at up to **7,871px of drift on a 1,176px grid**.
  Three-line fix.
- **`--ink-subtle` fails WCAG AA.** `#77777F` is **4.44:1** on white and is used as real text
  in **67 places**. The palette test only asserts the token _exists_ (line 33); it never
  checks its contrast.
- **Input borders fail WCAG 1.4.11.** `--line` `#E6E7EB` is **1.24:1** on canvas, against the
  3:1 required for UI component boundaries.

---

## 1. Design System Foundation

### 1.1 Governing principles

1. **Colour must have a job.** Every hue in this system encodes something. Decoration is
   what makes a palette tiring; encoding is what makes it fast. This rule already exists in
   `globals.css` and is the best thing about the current system — keep it.
2. **Ink is black. Always.** Blue, gold, rose, violet and coral never carry body copy.
   Existing rule, keep it, it is why the product reads well.
3. **One filled action per view.** A screen with three competing filled buttons has no
   primary action.
4. **Never encode by colour alone.** Every colour-coded thing carries a second channel —
   initials, an icon, a label, or position. Non-negotiable, and §1.3 proves why.

### 1.2 The palette

Verified with a WCAG 2.1 implementation matching `src/domain/branding/contrast.ts`.
**Every pairing below passes.** Status column is relative to what ships today.

#### Neutrals — warmed

The current neutrals are cool greys (`#FAFAFB`, `#F4F5F7`). Warming them a few degrees is the
single highest-ratio change in this document: it costs three token values, breaks nothing,
and moves the whole product from "clinical" to "inviting" without touching a component.

| Token           | Hex       | RGB channels  | Status                | Role                                                                                                                         |
| --------------- | --------- | ------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--ink`         | `#0B0B0C` | `11 11 12`    | **Keep**              | All body copy. 19.67:1 on canvas.                                                                                            |
| `--ink-muted`   | `#55555C` | `85 85 92`    | **Keep**              | Secondary copy. 7.39:1.                                                                                                      |
| `--ink-subtle`  | `#696971` | `105 105 113` | **RETUNE — a11y fix** | Was `#77777F` at 4.44:1 (**fails AA**). New value clears 4.5:1 on all seven surfaces it lands on.                            |
| `--ink-inverse` | `#FFFFFF` | `255 255 255` | **Keep**              | Text on filled colour.                                                                                                       |
| `--canvas`      | `#FFFFFF` | `255 255 255` | **Keep**              | Cards. Stays pure white.                                                                                                     |
| `--surface`     | `#FBFAF9` | `251 250 249` | **RETUNE**            | Was `#FAFAFB` (cool). Warmed.                                                                                                |
| `--surface-alt` | `#F5F3F1` | `245 243 241` | **RETUNE**            | Was `#F4F5F7` (cool). Warmed.                                                                                                |
| `--line`        | `#E8E5E1` | `232 229 225` | **RETUNE**            | Decorative hairlines only. Warmed to match.                                                                                  |
| `--line-strong` | `#D6D2CD` | `214 210 205` | **RETUNE**            | Heavier dividers.                                                                                                            |
| `--field`       | `#8A8A92` | `138 138 146` | **NEW — a11y fix**    | Input/select/textarea boundary. 3.43:1 canvas, 3.29:1 surface, 3.09:1 surface-alt — clears WCAG 1.4.11 everywhere. See §1.5. |

#### Primary — brandable

`branding.ts:91` writes **only** `--blue-${rung}`. This is the one family a salon can
replace at runtime. Gold and rose are deliberately locked (their meaning — money, and the
hair — is the same at every salon).

> **Constraint that shapes everything:** the design **must not depend on the primary's hue.**
> Any salon can turn it magenta. Use it for _structure and action_, never to mean a category.

| Token        | Hex       | Channels      | Status                | Contrast                                                                                                                                          |
| ------------ | --------- | ------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--blue-900` | `#10305A` | `16 48 90`    | Retune                | white 13.19:1 — nav column                                                                                                                        |
| `--blue-700` | `#1B5AA0` | `27 90 160`   | Retune                | white 6.96:1 — hover                                                                                                                              |
| `--blue-500` | `#1E74C8` | `30 116 200`  | **RETUNE — brighter** | white **4.79:1** — primary fill + focus ring                                                                                                      |
| `--blue-300` | `#5794CC` | `87 148 204`  | **RETUNE — a11y fix** | Border rung. 3.22:1 on white — the lightest value that clears the ladder's own `AA_UI` rule. Shipped `#85B3DB` is 2.22:1 and violates it. See A4. |
| `--blue-100` | `#E3F0FC` | `227 240 252` | Retune                | secondary button fill; `--blue-900` on it 11.39:1                                                                                                 |
| `--blue-50`  | `#F3F9FE` | `243 249 254` | Retune                | washes                                                                                                                                            |

> **A warning, learned the hard way.** My first attempt at "brighter" was `#2C7FD0`, which
> measures **4.16:1** with white — below AA. `globals.css` already carries a comment saying
> _"make it pop cannot walk it below contrast"_, and it is right. `#1E74C8` is the brightest,
> most saturated blue I could find that still clears 4.5:1 with white. Do not lighten it
> further without re-running the numbers.

#### Semantic and identity families

| Token                          | Hex                   | Channels      | Status  | Job                                                                            |
| ------------------------------ | --------------------- | ------------- | ------- | ------------------------------------------------------------------------------ |
| `--gold-700`                   | `#8A6C1F`             | `138 108 31`  | Keep    | Only gold rung that carries text (4.54:1 on gold-100)                          |
| `--gold-600`                   | `#A8842C`             | `168 132 44`  | Keep    | Borders/icons only — 3.50:1. **Not** gold-500: that measures 2.42:1 and fails. |
| `--gold-500`                   | `#C9A227`             | `201 162 39`  | Keep    | Fill. Black text 8.13:1. Money, status, the bookable processing gap.           |
| `--gold-300`                   | `#E2C766`             | `226 199 102` | Keep    | Hover fill                                                                     |
| `--gold-100`                   | `#FBF5E3`             | `251 245 227` | Keep    | Wash                                                                           |
| `--rose-700`                   | `#962F5C`             | `150 47 92`   | Keep    | Text on rose (6.54:1)                                                          |
| `--rose-500`                   | `#C75285`             | `199 82 133`  | Keep    | Marker, 4.22:1                                                                 |
| `--rose-100`                   | `#FCEEF5`             | `252 238 245` | Keep    | Wash — the hair itself                                                         |
| `--violet-700`                 | `#5B21B6`             | `91 33 182`   | **NEW** | Text on violet, 7.42:1                                                         |
| `--violet-500`                 | `#7C3AED`             | `124 58 237`  | **NEW** | Marker 5.70:1; carries **white** text at 5.70:1                                |
| `--violet-100`                 | `#EFE9FD`             | `239 233 253` | **NEW** | Wash                                                                           |
| `--coral-700`                  | `#9A3412`             | `154 52 18`   | **NEW** | Text on coral, 6.22:1                                                          |
| `--coral-500`                  | `#EA580C`             | `234 88 12`   | **NEW** | Marker 3.56:1 (**black** text only — 5.53:1)                                   |
| `--coral-100`                  | `#FFE8E0`             | `255 232 224` | **NEW** | Wash                                                                           |
| `--success` / `--success-soft` | `#2F6B4F` / `#EEF5F1` |               | Keep    | 5.68:1                                                                         |
| `--warn` / `--warn-soft`       | `#8A6108` / `#FDF4E5` |               | Keep    | 5.07:1                                                                         |
| `--danger` / `--danger-soft`   | `#A32E2E` / `#FBEFEF` |               | Keep    | 6.26:1                                                                         |

**Two new hues. Not eight.** §1.3 explains why that number is a hard ceiling, not timidity.

### 1.3 The categorical palette — and why it stops at five

`StylistProfile.colorHex` and `ServiceCategory.colorHex` already exist and are already
queried. Rendering them is the cheapest "vibrant" win available. But arbitrary user-chosen
hex means unmanaged contrast, and more importantly: **hues stop being distinguishable long
before you run out of them.**

I ran Viénot–Brettel–Mollon dichromat simulation over a candidate 8-hue set and measured
pairwise CIELAB ΔE under normal vision and all three dichromacies. Results:

| Set size | Best subset                                              | Worst-case ΔE (all vision types) | Verdict                                               |
| -------- | -------------------------------------------------------- | -------------------------------- | ----------------------------------------------------- |
| 8        | indigo, violet, fuchsia, rose, coral, amber, teal, ocean | **3.5**                          | Unusable — rose/teal are identical under deuteranopia |
| 7        | …minus teal                                              | 3.8                              | Unusable                                              |
| 6        | violet, fuchsia, coral, amber, teal, ocean               | 9.6                              | Confusable                                            |
| **5**    | **violet, rose, coral, amber, ocean**                    | **18.5**                         | **Safe**                                              |
| 4        | indigo, rose, coral, amber                               | 20.0                             | Safe                                                  |

**The categorical set is exactly five**, and three of them (`ocean`=blue, `amber`=gold,
`rose`) already ship. That is the entire cost of colour-coding every stylist and every
service category: two new hues.

Deuteranopia affects roughly 1 in 12 men. A salon's clients, owners and stylists include
them. An eight-colour diary is not more vibrant; it is a diary that lies to 8% of the men
who read it.

**Consequences for implementation:**

- Constrain `colorHex` to a **picker of these five**, not a free hex field. Free hex cannot
  be made safe — you cannot guarantee contrast or distinguishability on a value a user typed.
- Salons with more than five stylists reuse hues. That is fine, because —
- **Colour is never the only channel.** Every stylist chip carries initials; every column
  carries a name header. Colour makes scanning fast; the initials make it _correct_.
- Migrate the existing defaults (`#0F2A4A` for stylists, `#C9A227` for categories) onto the
  five-token set in a data migration.

Each hue is a **triple**, all verified:

| Hue    | fill (100) | marker (500/600) | label (700) | ink on fill | label on fill | marker on white |
| ------ | ---------- | ---------------- | ----------- | ----------- | ------------- | --------------- |
| ocean  | `#E3F0FC`  | `#1E74C8`        | `#10305A`   | 16.99       | 11.39         | 4.79            |
| rose   | `#FCEEF5`  | `#C75285`        | `#962F5C`   | 17.51       | 6.54          | 4.22            |
| amber  | `#FBF5E3`  | `#A8842C`        | `#8A6C1F`   | 18.05       | 4.54          | 3.50            |
| violet | `#EFE9FD`  | `#7C3AED`        | `#5B21B6`   | 16.24       | 7.42          | 5.70            |
| coral  | `#FFE8E0`  | `#EA580C`        | `#9A3412`   | 16.74       | 6.22          | 3.56            |

Calendar block anatomy: **tinted fill + 4px left marker + black label.** Never a saturated
fill behind text — that is what makes colourful calendars unreadable.

### 1.4 The `globals.css` diff

Tokens are declared **only** here, as space-separated RGB channels so Tailwind's alpha
modifiers keep working. A hex in this file silently breaks every `bg-blue-500/40` in the
product.

```diff
 @layer base {
   :root {
     --ink: 11 11 12;
     --ink-muted: 85 85 92;
-    --ink-subtle: 119 119 127;   /* #77777F — 4.44:1, FAILS AA as text */
+    --ink-subtle: 105 105 113;   /* #696971 — 4.70:1 worst case. Used as text in 67 places. */
     --ink-inverse: 255 255 255;

     --canvas: 255 255 255;
-    --surface: 250 250 251;      /* cool */
-    --surface-alt: 244 245 247;  /* cool */
+    --surface: 251 250 249;      /* #FBFAF9 — warmed */
+    --surface-alt: 245 243 241;  /* #F5F3F1 — warmed */

-    --line: 230 231 235;
-    --line-strong: 211 213 219;
+    --line: 232 229 225;         /* #E8E5E1 decorative hairlines only */
+    --line-strong: 214 210 205;  /* #D6D2CD */
+    /* Input boundaries are UI components under WCAG 1.4.11 and need 3:1.
+       --line is 1.24:1 and never satisfied it. Fields use this instead. */
+    --field: 138 138 146;        /* #8A8A92 — 3.43 canvas / 3.29 surface / 3.09 surface-alt */

-    --blue-900: 19 52 88;
-    --blue-700: 26 85 141;
-    --blue-500: 46 115 181;
-    --blue-300: 133 179 219;
-    --blue-100: 226 238 250;
-    --blue-50: 242 248 254;
+    /* Brightened one step. #1E74C8 is the most saturated blue that still
+       clears 4.5:1 with white. #2C7FD0 measures 4.16:1 — do not go there. */
+    --blue-900: 16 48 90;
+    --blue-700: 27 90 160;
+    --blue-500: 30 116 200;
+    --blue-300: 143 192 234;
+    --blue-100: 227 240 252;
+    --blue-50: 243 249 254;

     /* gold, rose, semantic — unchanged */

+    /* --- Identity. Stylist and service-category colour-coding.
+           Exactly five hues exist across the whole system (ocean = the blue
+           family, amber = gold, rose, plus these two). Five is the largest set
+           that stays distinguishable under deuteranopia, protanopia and
+           tritanopia — worst-case CIELAB dE 18.5. Do not add a sixth. --- */
+    --violet-700: 91 33 182;
+    --violet-500: 124 58 237;
+    --violet-100: 239 233 253;
+    --coral-700: 154 52 18;
+    --coral-500: 234 88 12;
+    --coral-100: 255 232 224;

     --radius: 10px;
+
+    /* --- Motion. Every transition in the product resolves through these. --- */
+    --ease-out: cubic-bezier(0.22, 1, 0.36, 1);      /* settle — things arriving */
+    --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);   /* travel — things moving */
+    --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);/* overshoot. Sparingly. */
+    --dur-instant: 90ms;    /* hover, press */
+    --dur-quick: 160ms;     /* toggles, chips */
+    --dur-settle: 240ms;    /* drop, panel, card */
+    --dur-celebrate: 520ms; /* the one success moment per flow */
   }
```

### 1.5 The `tailwind.config.ts` diff

```diff
       colors: {
         ink: { DEFAULT: c('ink'), muted: c('ink-muted'), subtle: c('ink-subtle'), inverse: c('ink-inverse') },
         canvas: c('canvas'),
         surface: { DEFAULT: c('surface'), alt: c('surface-alt') },
         line: { DEFAULT: c('line'), strong: c('line-strong') },
+        field: c('field'),
         blue:  { 900: c('blue-900'), 700: c('blue-700'), 500: c('blue-500'), 300: c('blue-300'), 100: c('blue-100'), 50: c('blue-50') },
         gold:  { 700: c('gold-700'), 600: c('gold-600'), 500: c('gold-500'), 300: c('gold-300'), 100: c('gold-100') },
         rose:  { 700: c('rose-700'), 500: c('rose-500'), 100: c('rose-100') },
+        violet:{ 700: c('violet-700'), 500: c('violet-500'), 100: c('violet-100') },
+        coral: { 700: c('coral-700'), 500: c('coral-500'), 100: c('coral-100') },
         ...
       },
       boxShadow: {
-        card: '0 1px 2px rgba(11, 11, 12, 0.04)',
-        raised: '0 2px 8px rgba(11, 11, 12, 0.05)',
-        overlay: '0 4px 16px rgba(11, 11, 12, 0.06)',
+        /* Two-layer: a tight contact shadow plus a soft ambient one. Same
+           restraint, materially more depth. Warm-tinted rather than neutral
+           black so it sits on the warmed surfaces without going grey. */
+        card:    '0 1px 2px rgba(41, 37, 33, 0.05)',
+        raised:  '0 1px 2px rgba(41, 37, 33, 0.06), 0 4px 12px -2px rgba(41, 37, 33, 0.08)',
+        overlay: '0 2px 4px rgba(41, 37, 33, 0.06), 0 12px 28px -6px rgba(41, 37, 33, 0.12)',
+        lifted:  '0 8px 16px -4px rgba(41, 37, 33, 0.14), 0 24px 48px -12px rgba(41, 37, 33, 0.18)', /* dragging only */
         modal: '0 12px 40px rgba(11, 11, 12, 0.12)',
       },
+      transitionTimingFunction: {
+        out: 'var(--ease-out)', 'in-out': 'var(--ease-in-out)', spring: 'var(--ease-spring)',
+      },
+      transitionDuration: {
+        instant: 'var(--dur-instant)', quick: 'var(--dur-quick)',
+        settle: 'var(--dur-settle)', celebrate: 'var(--dur-celebrate)',
+      },
       keyframes: {
         'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
         shimmer: { '100%': { transform: 'translateX(100%)' } },
+        'settle-in': {
+          '0%':   { opacity: '0', transform: 'translateY(6px) scale(0.985)' },
+          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
+        },
+        'snap-in': {   /* calendar block landing after a drop */
+          '0%':   { transform: 'scale(1.03)' },
+          '60%':  { transform: 'scale(0.995)' },
+          '100%': { transform: 'scale(1)' },
+        },
+        'stamp': {     /* the paid moment */
+          '0%':   { opacity: '0', transform: 'scale(0.6) rotate(-9deg)' },
+          '55%':  { opacity: '1', transform: 'scale(1.06) rotate(2deg)' },
+          '100%': { opacity: '1', transform: 'scale(1) rotate(0deg)' },
+        },
       },
       animation: {
         'fade-in': 'fade-in 180ms ease-out',
         shimmer: 'shimmer 1.6s infinite',
+        'settle-in': 'settle-in var(--dur-settle) var(--ease-out) both',
+        'snap-in': 'snap-in 260ms var(--ease-spring)',
+        'stamp': 'stamp var(--dur-celebrate) var(--ease-spring) both',
       },
```

### 1.6 The `palette.test.ts` additions

The test currently asserts `ink` and `ink-muted` across seven backgrounds, and a fixed list
of button pairings. It does **not** check `ink-subtle`, which is why a 4.44:1 token shipped
into 67 call sites. Add:

```ts
/* --- The gap that let #77777F ship. ink-subtle is TEXT, at 12-14px, in 67
       places. It gets the same 4.5:1 bar as every other text token. --- */
describe('ink-subtle is text and must clear AA', () => {
  const backgrounds = [
    'canvas',
    'surface',
    'surface-alt',
    'blue-50',
    'blue-100',
    'gold-100',
    'rose-100',
    'violet-100',
    'coral-100',
  ]
  it.each(backgrounds)('ink-subtle on %s', (bg) => {
    expect(contrastRatio(token('ink-subtle'), token(bg))).toBeGreaterThanOrEqual(AA_NORMAL)
  })
})

/* --- WCAG 1.4.11: an input's boundary identifies a UI component. --- */
describe('form field boundaries (3:1)', () => {
  it.each(['canvas', 'surface', 'surface-alt'])('field border on %s', (bg) => {
    expect(contrastRatio(token('field'), token(bg))).toBeGreaterThanOrEqual(AA_UI)
  })
})

/* --- The five identity hues. Each is a triple and all three legs must hold. --- */
const IDENTITY = ['blue', 'rose', 'gold', 'violet', 'coral'] as const
describe.each(IDENTITY)('identity hue: %s', (hue) => {
  const fill = hue === 'blue' ? 'blue-100' : `${hue}-100`
  const label = hue === 'blue' ? 'blue-900' : `${hue}-700`
  const marker = hue === 'gold' ? 'gold-600' : `${hue}-500` // gold-500 is 2.42:1 — a fill, never a marker
  it('black block copy on the fill', () =>
    expect(contrastRatio(token('ink'), token(fill))).toBeGreaterThanOrEqual(AA_NORMAL))
  it('coloured label on the fill', () =>
    expect(contrastRatio(token(label), token(fill))).toBeGreaterThanOrEqual(AA_NORMAL))
  it('marker is visible on canvas', () =>
    expect(contrastRatio(token(marker), token('canvas'))).toBeGreaterThanOrEqual(AA_UI))
  it('marker is visible against its own fill', () =>
    expect(contrastRatio(token(marker), token(fill))).toBeGreaterThanOrEqual(AA_UI))
})
```

> **The test also has UPPER bounds, which is easy to miss.** `palette.test.ts:135-145`
> asserts `gold-600` on canvas is `>= 3.0` **and `< 4.5`**, and that `gold-500` on canvas is
> **`< 4.5`**. These deliberately pin gold as a border/fill colour that can never be promoted
> to text. **You cannot darken gold to "make it pop" — the build fails either way.** Mirror
> this discipline for the two new hues: assert `coral-500` on canvas is `>= 3.0` and `< 4.5`,
> so nobody later uses it for text.
>
> **Also worth adding, and cheap:** a test that fails if any hex literal appears in a
> `.tsx` file outside `design-system/page.tsx`. The system's whole guarantee rests on
> components never using raw colour, and nothing currently enforces it.

### 1.7 Tenant branding — what is safe to re-skin

`branding.ts:91` writes `vars['--blue-${rung}']` and nothing else. So:

| Family                    | Brandable?  | Therefore                                                                                                                                                                                                                         |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--blue-*`                | **Yes**     | Structure and action only. **Never** use blue to mean a category — a salon can turn it any hue and the meaning evaporates. In the identity palette it is "ocean", and a branded salon simply has an ocean that matches its brand. |
| `--gold-*`, `--rose-*`    | No — locked | Money/status and hair. Same meaning everywhere.                                                                                                                                                                                   |
| `--violet-*`, `--coral-*` | No — locked | New identity hues. Lock them, or the CVD guarantee in §1.3 dies the moment a salon picks its own.                                                                                                                                 |
| semantic                  | No          | Success/warn/danger must never be brand-dependent.                                                                                                                                                                                |

`deriveAccentLadder` must be extended to also assert the new pairings when a salon saves a
brand colour, or the runtime half of the guarantee lags the shipped half.

### 1.8 Typography

**Recommendation: change one font, keep the other, and understand that this is the most
optional change in this brief.**

`layout.tsx` loads `Plus_Jakarta_Sans` (display) + `Inter` (body) via `next/font/google` with
CSS variables — a clean swap point.

- **Body/UI: keep Inter.** It is the correct choice and changing it would be vandalism.
  `globals.css` already enables `cv02, cv03, cv04, cv11` and tabular numerals for figure
  columns. Dense operational UI, tabular data, forty-three routes. Leave it alone.
- **Display: `Bricolage Grotesque`** (verified on Google Fonts). Variable, with genuine
  character — slightly irregular widths and a warmth that Plus Jakarta Sans does not have —
  while staying a grotesque, so it never reads as a toy. This is where the "fun" lands in the
  type system.
- **Honest caveat:** Plus Jakarta Sans is already good. If the team is short on time, skip
  this. It buys personality, not clarity, and it costs a re-check of every heading for
  wrapping at the narrow breakpoints. Do not let a font swap block §2.

```ts
// src/app/layout.tsx
import { Bricolage_Grotesque, Inter } from 'next/font/google'

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  axes: ['opsz'], // variable optical size
  weight: ['600', '700', '800'],
})
```

| Token        | Size            | Line height | Tracking | Weight | Font         | Use                                                                                                                       |
| ------------ | --------------- | ----------- | -------- | ------ | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `display-xl` | 2.5rem / 40px   | 1.15        | −0.02em  | 800    | Bricolage    | Page title, one per screen                                                                                                |
| `display-lg` | 2rem / 32px     | 1.2         | −0.02em  | 700    | Bricolage    | Screen heading                                                                                                            |
| `display-md` | 1.5rem / 24px   | 1.25        | −0.015em | 700    | Bricolage    | Section heading                                                                                                           |
| `display-sm` | 1.25rem / 20px  | 1.3         | −0.01em  | 700    | Bricolage    | Card title                                                                                                                |
| `body`       | 1rem / 16px     | 1.6         | 0        | 400    | Inter        | Body copy                                                                                                                 |
| `secondary`  | 0.875rem / 14px | 1.55        | 0        | 400    | Inter        | Table cells, secondary                                                                                                    |
| `label`      | 0.75rem / 12px  | 1.4         | 0.08em   | 500    | Inter        | Uppercase micro-label                                                                                                     |
| `numeric-lg` | 2rem / 32px     | 1.1         | −0.01em  | 700    | Inter _tnum_ | **NEW** — stat figures and money. Inter, not the display face: figures are compared vertically and need tabular numerals. |

> **Fix a latent inconsistency while you are here.** `Stat` in `data.tsx` renders its figure
> as `tabular mt-2 font-display text-display-lg`. It _does_ ask for tabular numerals — but
> `.tabular` sets `font-variant-numeric: tabular-nums`, which only takes effect if the face
> ships a `tnum` feature. Inter does; whether the display face does is a per-font question,
> and it silently no-ops if not. Money columns should not depend on that. Move `Stat` to
> `numeric-lg` (Inter) so alignment is guaranteed by the font choice, not hoped for.
> `feedback.tsx:20` also has a comment claiming empty states are "a serif headline"; nothing
> in this product is a serif. Delete the comment.

### 1.9 Component styling

Real class strings, ready to paste into the existing `cva` definitions.

#### Button — `src/components/ui/button.tsx`

The current variants are sound. The changes are: a **lift on hover** (transform, not just
colour), a **real press** (already `active:translate-y-px` — keep it), and consistent
motion tokens.

```ts
const buttonVariants = cva(
  // base
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold ' +
    'transition-[transform,box-shadow,background-color,border-color] duration-instant ease-out ' +
    'active:translate-y-px active:duration-[60ms] ' +
    'disabled:pointer-events-none disabled:opacity-45 ' +
    'motion-reduce:transition-none motion-reduce:hover:translate-y-0 ' +
    '[&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-blue-500 text-ink-inverse shadow-raised hover:-translate-y-px hover:bg-blue-700 hover:shadow-overlay active:bg-blue-900 active:shadow-card',
        secondary:
          'border border-blue-300 bg-blue-100 text-blue-900 hover:border-blue-500 hover:bg-blue-300/40', // full-opacity border: /60 composites to 1.93:1, see A4
        gold: 'bg-gold-500 text-ink shadow-raised hover:-translate-y-px hover:bg-gold-300 hover:shadow-overlay active:shadow-card',
        ghost: 'text-blue-700 hover:bg-blue-50',
        link: 'text-blue-500 underline-offset-4 hover:underline',
        danger: 'bg-danger text-ink-inverse shadow-raised hover:-translate-y-px hover:bg-danger/90',
        'danger-quiet': 'border-2 border-danger/30 bg-danger-soft text-danger hover:bg-danger/10',
      },
      size: {
        sm: 'h-10 px-3.5 text-secondary', // was h-9 (36px) — below the 44px touch target
        md: 'h-11 px-5 text-secondary',
        lg: 'h-12 px-7 text-body',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)
```

> `sm` moves 36px → 40px. Still under 44px, but `sm` buttons sit in dense toolbars where 44px
> would wreck the layout; 40px with adequate spacing is the pragmatic compromise. **Any
> `sm` button on a tablet-primary screen (the till, the diary) must use `md`.**

#### Card — `src/components/ui/card.tsx`

```ts
'rounded-xl border border-line bg-canvas shadow-card ' + 'transition-shadow duration-quick ease-out'
// interactive cards additionally:
;('hover:shadow-raised hover:border-line-strong motion-reduce:transition-none')
```

Radius `lg` (10px) → `xl` (16px) for cards only. Controls stay at 10px. The larger radius on
large surfaces is most of the perceived "softness" upgrade, and it costs one class.

#### Input / Field — `src/components/ui/field.tsx`

```ts
const inputStyles =
  'w-full rounded-lg border border-field bg-canvas px-3.5 py-2.5 text-body text-ink ' +
  'placeholder:text-ink-subtle ' +
  'transition-[border-color,box-shadow] duration-quick ease-out ' +
  'hover:border-ink-muted ' +
  'focus:border-blue-500 focus:shadow-[0_0_0_3px_rgb(var(--blue-500)/0.18)] ' +
  'focus:outline-none focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-ink-subtle ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:shadow-[0_0_0_3px_rgb(var(--danger)/0.15)] ' +
  'motion-reduce:transition-none'
```

`border-line` → **`border-field`** is the WCAG 1.4.11 fix. The focus ring becomes a soft
3px halo rather than a hard outline — friendlier, and still 4.79:1 against white.

#### Badge, Table row, Stat

- **Badge** — add `tone: 'violet' | 'coral'` mirroring the existing pattern
  (`bg-violet-100 text-violet-700`). Add `dot?: boolean` to render a 6px `bg-*-500` dot, so a
  badge never relies on fill colour alone.
- **Table row** — `hover:bg-surface-alt` stays. Add `focus-within:bg-surface-alt` so keyboard
  users get the same affordance.
- **Stat** — add `tone: 'identity'` accepting one of the five hues; render as a 3px top rule
  in the marker colour rather than a full wash, so a row of tiles reads as a set.

### 1.10 Elevation, radius, motion

| Scale            | Value                                          | Use                                                                                                         |
| ---------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `shadow-card`    | `0 1px 2px rgba(41,37,33,.05)`                 | Resting card                                                                                                |
| `shadow-raised`  | contact + `0 4px 12px -2px /.08`               | Buttons, hovered cards                                                                                      |
| `shadow-overlay` | contact + `0 12px 28px -6px /.12`              | Popovers, hovered primary                                                                                   |
| `shadow-lifted`  | `0 8px 16px -4px /.14, 0 24px 48px -12px /.18` | **Dragging only.** The only genuinely dramatic shadow, and it exists so a dragged block reads as picked up. |
| `shadow-modal`   | `0 12px 40px rgba(11,11,12,.12)`               | Dialogs                                                                                                     |

Radius: controls `10px`, cards `16px`, pills `999px`, calendar blocks `8px`.

Motion durations and easings are in §1.4. **Rules:** animate `transform` and `opacity` only
(compositor-only — never `top`, `height`, `width`, `margin`, or `box-shadow` on a list of
items). `prefers-reduced-motion` is already handled globally in `globals.css`; components
additionally carry `motion-reduce:` classes so a reduced-motion user still gets the _state
change_, just not the travel.

---

## 2. Key Screens

### 2.1 The Stylist Dashboard

**Status: does not exist. See §0.1.** A stylist is denied `appointment.viewAny` and cannot
open `/desk`. What follows assumes the permission work lands first.

**Build it as a new route: `/s/[salon]/my-day`, gated on `appointment.viewOwn`** — the
permission that already exists and that nothing uses. Do not widen `viewAny`; a stylist
seeing every colleague's column, takings and client list is a privacy regression, not a
feature.

Three audiences, three surfaces, one visual language:

| Role         | Route                | Question it answers                                                                     |
| ------------ | -------------------- | --------------------------------------------------------------------------------------- |
| Stylist      | `/my-day` **(new)**  | "What is my next three hours, and what do I need to know before each client sits down?" |
| Receptionist | `/desk` (exists)     | "Who is late, who is waiting, who owes money?"                                          |
| Owner        | `/insights` (exists) | "Is the business working?"                                                              |

```
┌──────────────────────────────────────────────────────────────────────┐
│  Thursday 8 May                                    [ ‹ ] [Today] [ › ]│
│  Maya Okafor · 6 in the chair · finishing 17:45                      │
├──────────────────────────────────────────────────────────────────────┤
│  NEXT UP  ── the only card above the fold that matters ──            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ ▌ 11:30  ADA LOVELACE                       in 12 min          │  │
│  │ ▌ Balayage + gloss · 2h 45m                                    │  │
│  │ ▌ ⚠ Patch test due · Box dye declared 2024-11                  │  │
│  │ ▌ Last formula: 9NV + 20vol, 35 min, no heat        [ Open ]   │  │
│  └────────────────────────────────────────────────────────────────┘  │
│    ▲ 4px left marker in MY identity colour. Risk flags inline —      │
│      this is the "30 seconds before they sit down" card.             │
├──────────────────────────────────────────────────────────────────────┤
│  THE REST OF MY DAY                                                   │
│  ▌ 14:30  Grace Hopper    Cut & finish      1h 15m                    │
│  ▌ 16:15  Joan Clarke     Root touch-up     1h 30m       ⚑ new client │
│  ░ 12:15–12:45  PROCESSING — you are free, desk may fill this        │
├──────────────────────────────────────────────────────────────────────┤
│  MY WEEK        [ Hours booked 31.5 ] [ Rebook rate 62% ] [ ⚠ 2 gaps ]│
└──────────────────────────────────────────────────────────────────────┘
```

**Data honesty.** `deskDay` (`front-desk.ts`) returns `stats.booked / arrived /
expectedCents / unpaidDeposits` and the state groups. `analytics.ts` exposes
`accuracyReport, funnelReport, utilisationReport, ruleReport, revenueReport, ownerDashboard`
— all **salon-scoped**. There is **no per-stylist performance query**. "Hours booked",
"rebook rate" and "gaps" in the wireframe above each need a new service function scoped to
one `stylistProfileId`. Budget for that; do not let a designer promise it as free.

**At-a-glance hierarchy** — readable from two metres:

1. Client name — `display-sm`, `--ink`, semibold
2. Time — `numeric-lg`, tabular
3. Everything else — `secondary`/`label`, `--ink-muted`

**Keep `/desk`'s single best idea.** Grouping by _what needs doing_ (`Running late` /
`Arriving` / `In the chair` / `Processing` / `Finished`) rather than chronologically is
genuinely better than what most salon software does. Do not "modernise" it into a plain
timeline. "Running late" keeps its `danger` left-accent — `feedback.tsx` is right that a
screen full of red is a screen people learn to ignore.

### 2.2 The Interactive Calendar

The highest-value and highest-risk screen. Read §0.1 before estimating.

#### What is actually there

`daySchedule` returns stylist columns of **segments**, not appointments. Each segment carries
`kind` (`BUFFER_BEFORE | ACTIVE | PROCESSING | RINSE | BUFFER_AFTER | BLOCK`), `state`
(`ACTIVE | HOLD | RELEASED`), `blocksStylist`, and `appointmentId`. A gold `PROCESSING` block
where `blocksStylist === false` is **bookable by a different client** — clicking it goes to
`/desk/book?fill={segmentId}`.

**That is the product's real competitive advantage** and most salon calendars cannot express
it. Every redesign decision below protects it.

#### Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ The day    Thu 8 May          [Day|3-Day|Week]   [‹][Today][›]   [+ Book]     │
│ Stylists:  (•Maya)(•Ren)(•Ada)(•Joan)  [All]      ← chips, identity-coloured   │
├──────┬───────────────┬───────────────┬───────────────┬───────────────────────┤
│      │ ● MAYA        │ ● REN         │ ● ADA         │ ● JOAN                │
│ 09   │┌─────────────┐│               │┌─────────────┐│                       │
│      ││▌Ada Lovelace││               ││▌G. Hopper   ││   ▌ = 4px marker in   │
│ 10   ││▌Balayage    ││┌─────────────┐││▌Cut & finish││       stylist colour  │
│      │└─────────────┘││▌J. Clarke   ││└─────────────┘│                       │
│ 11   │╔═════════════╗││▌Root touch  ││               │┌─────────────┐        │
│      │║ PROCESSING  ║│└─────────────┘│               ││▌Walk-in     │        │
│ 12   │║ free — book ║│               │               │└─────────────┘        │
│      │╚═════════════╝│               │               │                       │
│ 13   │  ░░░ lunch ░░░│               │               │                       │
└──────┴───────────────┴───────────────┴───────────────┴───────────────────────┘
       ── NOW line: 2px coral, full width, with a time pip in the gutter ──
```

- **Block anatomy:** `bg-{hue}-100` fill, `border-l-4 border-{hue}-500`, `--ink` label.
  Never a saturated fill behind text.
- **Processing blocks keep gold** and gain a subtle diagonal hatch, so "free" is encoded by
  _pattern as well as colour_ — a stylist with deuteranopia must still find sellable gaps.
  **But design for their absence:** `interleaveEnabled` defaults to **false**
  (`tenancy.prisma:146`), so on a default salon there are **no gold blocks at all**. The
  "sell the gap" story is a feature of salons that switched it on. The diary must look
  finished and intentional with zero gold on screen, and the empty state must not read as
  broken.
- **Staff filter** is a row of identity-coloured chips with initials, multi-select, state in
  the URL (`?stylists=a,b`) so it survives refresh and is shareable. Not a dropdown.
- **NOW line** in coral — the one place coral appears on this screen, so it never competes.

#### Density and the touch-target problem

`PIXELS_PER_MIN = 1.4` with `blockHeight = Math.max(14, …)`. A 10-minute segment renders
**14px tall** — one third of the 44px minimum target, and far too short for its own label.

Fix: keep 1.4 px/min as the _default_ but add a density control (Compact 1.0 / Comfortable
1.4 / Roomy 2.0, persisted per user). Independently, enforce a **44px minimum hit area** by
giving short blocks a transparent `::after` overlay that extends the touch region without
changing the visual height:

```css
.cal-block {
  position: relative;
}
.cal-block::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  top: 50%;
  transform: translateY(-50%);
  height: max(100%, 44px);
}
```

#### Drag and drop — the honest version

**Do not use a drag-and-drop library.** `dnd-kit`, `react-beautiful-dnd` and friends are
built for reordering lists. This is a two-axis, continuous, snap-to-grid, constraint-validated
positioning problem across a chain of linked segments. You will fight the library.

**Use the Pointer Events API directly.** It is roughly 200 lines, handles mouse/touch/pen in
one code path via `pointerdown/move/up` + `setPointerCapture`, and adds **zero** bundle
weight.

**The architecture change.** The calendar is currently a Server Component with `export const
dynamic = 'force-dynamic'`. It must become a server shell wrapping a client island:

```
src/app/s/[salon]/desk/calendar/
  page.tsx          server — auth, daySchedule(), passes plain serialisable props
  day-grid.tsx      'use client' — the island: layout, drag, keyboard, optimistic state
  block.tsx         'use client' — one segment
  use-drag.ts       'use client' — the pointer state machine
```

`scripts/check-client-boundary.mjs` forbids a server module importing a _non-JSX_ export from
a client module. `page.tsx` importing `<DayGrid />` as JSX is fine. Keep `minutesInto` and
all formatting in `src/lib/format.ts` (unmarked, shared) — **do not** let a helper drift into
`day-grid.tsx` and get imported back by the server, or the boundary check fails.

**Drag state machine:**

```
        pointerdown (primary, on a block)
IDLE ─────────────────────────────────────► ARMED
                                             │  pointermove > 4px  ── OR ── 400ms long-press (touch)
                                             ▼
                                          DRAGGING ── pointermove ──► (snap to 5-min, validate)
                                             │                              │
                                             │                       valid ─┴─ invalid
                                             │                         ▼         ▼
                                             │                   ghost=ok   ghost=blocked
                                             │ pointerup
                                             ▼
                                         DROPPING ──► optimistic move + snap-in animation
                                             │              │
                                             │        server rejects
                                             │              ▼
                                             │        rollback + shake + toast with reason
                                             ▼
                                           IDLE
        Escape at any point ──► cancel, return to origin, no server call
```

- **Grab affordance:** `cursor: grab`; on hover the block lifts 1px and gains
  `shadow-raised`. During drag: `cursor: grabbing`, `shadow-lifted`, `opacity .92`,
  `scale(1.02)`, and a **live time label pinned to the pointer** ("11:45 – 14:30").
- **Snap: `SchedulingSettings.slotGranularityMin`, which defaults to 15 — not 5.**
  `round5` in `chain.ts` rounds phase _durations_; slot _starts_ are offered on the
  granularity grid (`tenancy.prisma:137`). Read the salon's value and snap to it. Snapping
  to 5 produces starts the solver would never have offered, so every other drop is rejected.
- **The chain moves, not the block.** Dragging the `ACTIVE` segment translates the whole
  `PhaseChain` — buffers, processing, rinse — preserving relative offsets. Show the ghost for
  every segment, so a stylist can see the processing gap land somewhere useful.
- **Invalid drop:** ghost turns `danger`, drop is refused with a 180ms horizontal shake and a
  toast naming the reason ("Ren is not rostered after 18:00"). Never a silent snap-back.
- **Resize:** 8px top/bottom handles, `cursor: ns-resize`, keyboard `Shift+↑/↓`. Only
  `isScalable` phases resize — chemistry does not stretch.
- **Optimistic then confirm:** move locally, call the server action, roll back on rejection.

#### The server action you have to write first

```ts
// src/server/actions/scheduling.ts  — DOES NOT EXIST YET
export const rescheduleAppointmentAction = withAuthz(
  'appointment.reschedule', // new action in domain/authz/actions.ts + policy.ts
  z.object({
    appointmentId: z.string(),
    stylistProfileId: z.string(),
    startsAt: z.string().datetime(),
    idempotencyKey: z.string(), // same discipline as till.tsx — a dropped
  }), // block that retries must not double-book
  async (ctx, input) => {
    /* rebuild chain, re-run conflict + roster + resource
                             validation, write segments in one transaction */
  },
)
```

This is the real work. The UI is the easy half. Six constraints make it harder than it looks,
and any estimate that ignores them is wrong:

1. **The database enforces non-overlap.** Migration `20260802180000_segment_exclusion_and_rls`
   adds GiST `EXCLUDE` constraints on `(stylistProfileId, period)` where `blocksStylist`, over
   a generated half-open `tstzrange`. A reschedule that shifts ranges can **transiently
   self-violate** the constraint mid-UPDATE.
2. **Segments must move by `UPDATE`, never delete-then-insert** (`booking.ts:229-232`),
   or the slot momentarily reads as free to a concurrent booker.
3. **Advisory locks must be ordered.** Every write path takes
   `pg_advisory_xact_lock` on `(stylistId, localDate)` (`booking.ts:60`). A reschedule
   touches **two** such pairs — acquire them in a deterministic order or two concurrent
   swaps deadlock.
4. **The solver will collide with itself.** `LoadOptions` (`loader.ts:30-49`) has **no
   `excludeAppointmentId`**, so an availability solve sees the moving appointment's own
   segments as busy. Adding one also means extending the module-level TTL cache key, or a
   stale availability answer gets served.
5. **Same-day drags are refused by default.** `minBookingLeadMin` defaults to **120**
   (`tenancy.prisma:138`) and `availability.ts:41` refuses any start before `nowMin + lead`.
   "Push the 3pm to 3:30" at 2:55 — the single most common desk action — is unsolvable
   without the unimplemented `forceSlot` override path.
6. **`maxConcurrentClients` (default 2) is a counting invariant the exclusion constraint
   cannot express** (`availability.ts:139-141`). A drop that looks free can still be refused,
   so the UI must treat server rejection as normal, not exceptional.

#### Keyboard — mandatory, not a nice-to-have

A drag-only calendar is inaccessible and, in several jurisdictions, non-compliant.

| Key           | Action                                  |
| ------------- | --------------------------------------- |
| `Tab`         | Move between blocks in time order       |
| `Enter`       | Open the appointment                    |
| `Space`       | Pick up / put down (enters "move mode") |
| `↑ / ↓`       | Move ±5 min (`Shift` ±30)               |
| `← / →`       | Move to previous/next stylist column    |
| `Shift + ↑/↓` | Resize the end                          |
| `Escape`      | Cancel, return to origin                |

Every move announces through a single `aria-live="polite"` region:
_"Ada Lovelace, balayage, moved to 11:45, Maya. Processing 12:15 to 12:45 now free."_
Debounce announcements to 150ms or arrow-key repeat floods the screen reader.

#### Phased delivery — be realistic

| Phase  | Ships                                                                                                                                         | Effort                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **C1** | Fix the gutter bug (Appendix A). Identity colours from `colorHex`. Density control. NOW line. Staff filter chips. Touch targets. **No drag.** | ~1 wk. Ships alone and already feels transformed. |
| **C2** | `rescheduleAppointmentAction` + chain revalidation + tests. **Server only, no UI.**                                                           | ~1.5–2 wks                                        |
| **C3** | Client island, pointer drag, keyboard parity, optimistic + rollback                                                                           | ~1.5–2 wks                                        |
| **C4** | Resize, week view, cross-day drag                                                                                                             | ~1.5 wks                                          |

**Ship C1 on its own.** It is the best value in this document and it does not depend on C2.

### 2.3 Client Profiles

The most valuable screen in the product and, right now, the weakest.

#### What is wrong is IA, not styling

`desk/clients/[id]/page.tsx` is 518 lines of **eleven flat stacked sections** in one scroll:
Notes → Deposits → Cancellation fees → Coming up → Consent and safety → Forms → What they
can ask for → Membership → When they need to be back → What their hair is like → Strand
tests → Their hair.

Three things are badly wrong with that order and content:

1. **`HairTimeline` — the point of the whole record — is last**, roughly 3,000px down, below
   GDPR subject-rights, membership admin and cancellation-fee admin.
2. **Zero safety facts render.** `priorReactionToColor`, `allergiesJson`, `medicationsJson`,
   `isPregnantOrNursing`, `scalpSensitivity`, `hasHenna`, `hasBoxDye`, `breakageReported` are
   all stored on `HairProfile` and **read by the rules engine** — and appear **nowhere** on
   the screen a stylist opens before mixing colour. The appointment page
   (`desk/appointment/[id]/page.tsx:149-200`) already has exactly the right pattern. Reuse it.
3. **Colour formulas do not appear at all.** `client-portal.ts:197-201` includes only
   `stylistProfile`, so the timeline shows _"Colour formula · 30 vol · 45 min · 4/5"_ while
   the database holds the full bowl — brand, shade, parts, grams. The components render only
   on the appointment page. **A colourist cannot see a client's colour history from the
   client's own page.**

Also unused and ready to render: `ClientProfile.tags` (a ready-made flag vocabulary),
`pronouns`, `dateOfBirth`, `preferredStylistId`, `lifetimeSpendCents`, `firstVisitAt`,
`lastVisitAt`. And `StrandTest.formulaId` exists but is not followed, so _"we tested this
formula and it snapped"_ is split across hundreds of pixels.

#### The layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ┌────┐  ADA LOVELACE  (she/her)              ⚠ PATCH TEST DUE            │ ← sticky
│ │ AL │  Member · Gold      Last in 6 wks     ● Prefers Maya               │   header
│ └────┘  £2,480 lifetime · 14 visits          [ Book ] [ Start consult ]   │
├───────────────────────────────────────────────────────────────────────────┤
│ ⚠ BEFORE YOU MIX  ── danger left-accent, always first, never collapsed ──  │
│   Reaction to PPD (2023-04) · Box dye declared 2024-11 · Henna: no        │
│   Scalp: sensitive · Breakage reported · Patch test EXPIRED 2025-11-02    │
├───────────────────────────────────────────────────────────────────────────┤
│ [ Hair ]  [ Visits ]  [ Photos ]  [ Money ]  [ Admin ]      ← <details> or │
│                                                               URL tabs     │
│  ▸ LAST FORMULA                          [ Copy to new visit ]            │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │ ▌ Global colour · 2025-03-14 · Maya                              │     │
│  │ ▌ Wella Koleston 7/1  40g  +  9/0  20g                           │     │
│  │ ▌ 20 vol · 1:1.5 · 35 min · no heat                              │     │
│  │ ▌ Sectioning: four quadrants, roots first                        │     │
│  │ ▌ Result ★★★★☆  "slightly warm at the ends"                      │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│  ▸ HAIR TIMELINE — every chemical event, newest first                     │
└───────────────────────────────────────────────────────────────────────────┘
```

**Rules:**

- **Header is sticky and always visible.** Name, pronouns, preferred stylist, and the single
  most urgent flag. Nothing else competes.
- **"Before you mix" is a `danger`/`warn` left-accent strip, always expanded, always first.**
  This is the one place in the product where alarm is correct.
- **Tabs, not an 11-section scroll.** Use `<details>`/URL-param tabs, **not** a client-side
  tab shell — the eight existing panels are client components receiving serialisable props,
  and wrapping them in a client shell would force their data across the boundary.
- **Formula cards** get the identity colour of the stylist who mixed them, mono for the
  numbers, and a **`Copy to new visit`** action. `saveFormulaAction` already exists.
- **Money and admin move behind tabs.** Deposits and cancellation fees are real, and they are
  not what someone opens this page for.

**Cheapest high-value change in the whole brief:** add
`components: { orderBy: { sequence: 'asc' } }` to the formula include at
`client-portal.ts:197` and render brand/shade/parts/grams. **Two lines of query change** turn
the timeline from a summary into the actual record.

#### Before/after photos — the honest position

The marketing page (`src/app/page.tsx:21`) advertises before-and-after photos. **The data
model cannot represent them.** `AppointmentPhoto` with `BEFORE / PROGRESS / AFTER` was
dropped in `20260806050000_drop_unused_models`. Today there is no stage discriminator on
`PhotoAsset` or `ConsultationPhoto`, no `appointmentId` on either, and the only upload path
(`POST /api/uploads`) requires a `consultationId`. The client record renders **no photos at
all** — no query, no `<img>`, in 518 lines.

Do not try to fake pairing off `PhotoView` + `sequence`. `@@unique([consultationId, view,
sequence])` permits it, but `PhotoCaptureGrid`'s `byView` map (line 76) and `photoProgress`
(line 280) both assume one-photo-per-view and would silently drop the second.

**Required before any gallery UI:**

```prisma
model AppointmentPhoto {
  id             String   @id @default(cuid())
  salonId        String
  appointmentId  String
  photoAssetId   String
  stage          PhotoStage         // BEFORE | PROGRESS | AFTER
  view           PhotoView          // reuse the existing enum
  sequence       Int      @default(0)
  @@unique([appointmentId, stage, view, sequence])
}
```

Then the comparison UI is easy: a drag-divider slider comparing the same `view` at `BEFORE`
and `AFTER`, keyboard-operable with `←/→`, defaulting to `FRONT`. Consent gating is already
solved — `PhotoAsset` carries `isClientVisible`, `isMarketingApproved` and `consentGrantId`,
and EXIF is stripped in `photo.process` before anything is shown. Respect all three.

> Also: `ConsentGrant` has **10 kinds** and `ConsentPanel` exposes **5**. The four missing
> include `CHEMICAL_SERVICE` and `CORRECTION_SERVICE` — the two most legally load-bearing.
> Surface them.

### 2.4 Point of Sale

The only one of the four that is genuinely a frontend job. **Do this first.**

#### Fix the bug before the redesign

`till.tsx:445-469` renders the tip input and the open-amount discount in **one grid cell via
a ternary** — they are mutually exclusive in the DOM. Choosing an `OPEN` discount unmounts
the tip input while `tip` state **stays in `billPayload`**. A tip typed and then hidden is
silently applied to the bill. That is a live money bug. Five lines: give them separate cells,
and clear `tip` when the field unmounts.

#### The tip screen

Tips are a bare `<input type="number">` today. The server side is complete — `tipCents`
exists, is never taxed, never discounted, and is tracked per payment.

```
┌─────────────────────────────────────────────────────┐
│  Ada Lovelace · Balayage + gloss · Maya              │
│                                                      │
│  Services                              £145.00       │
│  Member discount                       − £14.50      │
│  ─────────────────────────────────────────────       │
│  Subtotal                              £130.50       │
│                                                      │
│  ADD A TIP                                           │
│  ┌────────┬────────┬────────┬────────┬────────┐      │
│  │  No    │  10%   │  15%   │  20%   │ Custom │      │
│  │  tip   │ £13.05 │ £19.58 │ £26.10 │        │      │
│  └────────┴────────┴────────┴────────┴────────┘      │
│              ▲ 15% preselected, 56px tall            │
│                                                      │
│  Total                                 £150.08       │
│                            [  Take payment  ]        │
└─────────────────────────────────────────────────────┘
```

- **Presets, showing the money.** People tip on the amount, not the percentage. Render both.
- **Percentage base must be `preview.subtotalCents - preview.discountCents`.** Not
  `preview.totalCents` — that already includes the current tip (`pricing.ts:264`), so
  percentages computed off it **compound**.
- **15% preselected, "No tip" first and equally weighted.** No shaming, no dark pattern. A
  tip screen that pressures a client in front of their stylist damages the relationship the
  salon depends on.
- **56px targets.** This is tablet-first and often handed to the client.
- **Announce changes** via `aria-live="polite"`: _"Tip £19.58. Total £150.08."_
- **Timing constraint:** the tip must be set **before** the invoice is issued.
  `buildInvoice` throws `CONFLICT` on a second attempt (`commerce.ts:820`) and there is no
  update or void path (`commerce.ts:1160`). A "tip after seeing the total" flow needs new
  server work — scope it or make the ordering explicit in the UI.

#### The rest of the till

| Problem                                                                                                                        | Fix                                                                                  | Cost    |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------- |
| Retail is free text — hand-typed description and price. `RetailProduct` (sku, name, priceCents, stockQty) is **never queried** | Product search/barcode against `RetailProduct`, decrement stock                      | ~3 d    |
| No quantity control, despite `quantity` existing in `TillLine`, the zod schema and `computeInvoice`                            | Stepper on `LineRow`                                                                 | hours   |
| Gift card balance never shown before redemption                                                                                | `findGiftCard` (`commerce.ts:1424`) already returns `balanceCents` — one thin action | hours   |
| "Produce the bill" is irreversible and looks like every other primary button                                                   | Distinct treatment + confirm                                                         | hours   |
| Card path dead-ends in production — no Stripe Elements on the till; with a real key and no saved card, `pay()` errors out      | Mount `CardOnFile` / Elements on this screen                                         | ~2 d    |
| Mode C is a dead end — no receipt, no print, no email, no rebook. `grep -i receipt` returns **zero** UI hits                   | Receipt + **rebook prompt** — the highest-revenue element on the screen              | ~2 d    |
| `payWithCard` handler is misnamed (`till.tsx:262`)                                                                             | Rename                                                                               | minutes |

**Do not compute totals in the browser.** Both preview and commit go through `priceInvoice`
→ `computeInvoice`. Animating a total by summing client-side reintroduces exactly the
"a till that adds up its own total is a till that can be argued with" problem the file's own
comment warns about. Animate the _presentation_ of the server's number.

**Do not re-key `attemptKey` on re-render or on amount change** (`till.tsx:129, 257, 282`).
It is minted once per attempt and re-minted only after success. That discipline is what makes
a retry a retry instead of a second charge.

---

## 3. Delightful Details

### 3.0 The starting position, and the restraint budget

**The motion layer is currently zero.** `animate-fade-in` and `animate-shimmer` are declared
in `tailwind.config.ts` and used in **exactly 0 files** — `grep -rn "animate-" src/` returns
nothing. There are **0 `loading.tsx` files** and no skeleton component anywhere. Every page is
a `force-dynamic` async RSC, so during navigation users currently stare at the _previous
page_ with no feedback at all.

That is good news: "playful brief loading animations" is not a polish item, it is **missing
feedback**, and it is the highest-value item in this section.

**The restraint budget — the rule that keeps this from becoming annoying:**

> **Two animated moments per screen, plus state feedback.** State feedback (hover, press,
> focus, disabled) is free and should be everywhere. _Announcements_ — anything that draws
> the eye without being asked — are capped at two per screen, and only one may celebrate.

A stylist sees the diary 200 times a day. A 500ms flourish that delights on day one is
something they wait through 200 times on day thirty. Every animation below is under 550ms,
and the only one over 300ms fires **once per completed sale**.

**Rejected deliberately:**

- _Number count-up on stat tiles_ — animating a figure means it is briefly **wrong**. On a
  screen showing takings, that is unacceptable. Fade the tile in; never roll the digits.
- _Page transitions_ — with `force-dynamic` RSC they would fight the streaming boundary and
  add perceived latency.
- _Bouncy spring easing as a default_ — reserved for the two moments below. Everywhere else
  it reads as unserious.
- _Confetti on checkout_ — for a receptionist closing 40 sales a day this becomes contempt.
  §3.2 is the disciplined version.
- _Animated nav indicator_ — the nav is a column of 16 links; movement there is distraction.

---

### 3.1 Snap-and-settle — the calendar drop

**The signature interaction.** Everything about whether the calendar feels alive lives here.

|               |                                                                 |
| ------------- | --------------------------------------------------------------- |
| **Trigger**   | `pointerup` on a valid drop target                              |
| **Frequency** | Dozens/day per user — so it must be _fast_ and never in the way |
| **Cost**      | Ships with C3                                                   |

The block travels from wherever the pointer released to its snapped position, then settles
with a single small overshoot. Simultaneously the drop shadow collapses from `shadow-lifted`
back to `shadow-card` — that is what sells "put down" rather than "teleported".

```css
@keyframes snap-in {
  0% {
    transform: scale(1.03);
  }
  60% {
    transform: scale(0.995);
  }
  100% {
    transform: scale(1);
  }
}
.cal-block[data-state='dropping'] {
  animation: snap-in 260ms var(--ease-spring);
  transition:
    box-shadow 240ms var(--ease-out),
    translate 200ms var(--ease-out);
  box-shadow: var(--shadow-card);
}
.cal-block[data-state='dragging'] {
  box-shadow: var(--shadow-lifted);
  scale: 1.02;
  opacity: 0.92;
  cursor: grabbing;
  z-index: 30;
}
@media (prefers-reduced-motion: reduce) {
  .cal-block[data-state='dropping'] {
    animation: none;
    transition: none;
  }
}
```

- Use the **`translate` and `scale` CSS properties** (not the `transform` shorthand) so drag
  translation and settle scale animate independently without clobbering each other.
- Position blocks with `translate: 0 <Ypx>` during drag, **never** by animating `top` —
  `top` triggers layout on every frame across every block in the column.
- **Rejection variant:** on server refusal the block returns to origin over 200ms and shakes
  — `translate: -3px → 3px → 0` over 180ms — plus a toast naming the reason. Reduced-motion
  users get the toast and a `danger` border flash, no travel.
- **The satisfying detail:** while dragging, the _origin_ slot shows a dashed outline and the
  **processing gap that would be freed up highlights in gold**. You are not moving a
  rectangle, you are seeing the day rearrange. That is the product's actual value made
  visible, and it costs one extra element.

---

### 3.2 The paid moment

|               |                                                                         |
| ------------- | ----------------------------------------------------------------------- |
| **Trigger**   | `takePaymentAction` resolves and the balance reaches zero               |
| **Frequency** | Once per completed sale — the only place a 520ms flourish is affordable |
| **Cost**      | Ships with the POS phase, ~half a day                                   |

The outstanding figure crossfades to `£0.00`, a **PAID** stamp scales in with a slight
rotation, and a hairline gold rule sweeps left-to-right beneath it. Then the screen resolves
into the receipt + rebook prompt.

```css
@keyframes stamp {
  0% {
    opacity: 0;
    transform: scale(0.6) rotate(-9deg);
  }
  55% {
    opacity: 1;
    transform: scale(1.06) rotate(2deg);
  }
  100% {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
}
.paid-stamp {
  animation: stamp var(--dur-celebrate) var(--ease-spring) both;
}
.paid-rule {
  transform-origin: left;
  animation: sweep 380ms var(--ease-out) 140ms both;
}
@keyframes sweep {
  from {
    scale: 0 1;
  }
  to {
    scale: 1 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .paid-stamp,
  .paid-rule {
    animation: none;
    opacity: 1;
    scale: 1;
  }
}
```

- **Gold, not green.** Gold already means money and status in this system. Green means
  "success" generically and would break the palette's semantics.
- **Not blocking.** The rebook prompt is interactive from frame one — a receptionist who
  knows what they are doing must never wait for an animation.
- **`aria-live="assertive"`**: _"Paid in full. £150.08 including £19.58 tip."_
- **This is the one celebration in the product.** Adding a second devalues it.

---

### 3.3 Formula lift — "copy to new visit"

|               |                                                  |
| ------------- | ------------------------------------------------ |
| **Trigger**   | Tapping `Copy to new visit` on a formula card    |
| **Frequency** | Several times a day per colourist                |
| **Cost**      | Ships with the client-profile phase, ~half a day |

A colourist's most repeated action is _"the same as last time, slightly warmer"_. Today it is
retyping from another page. The card should physically **lift, duplicate and fly into the new
visit** — the interaction _is_ the explanation of what happened.

- The source card lifts to `shadow-overlay` and scales to `1.02` over 120ms.
- A clone crossfades in offset by `6px, 6px`, then travels to the target region over 240ms
  with `--ease-in-out`.
- The target field flashes a `blue-100` background for 400ms and receives focus.
- Reduced motion: no travel; the target flashes and focuses, and the toast still fires.
- **`aria-live="polite"`**: _"Formula copied. Wella Koleston 7/1 40g plus 9/0 20g, 20 vol, 35
  minutes. Editable."_

The important part is the **focus move**, not the animation. Get that right first; the motion
is garnish on a genuine workflow saving.

---

### 3.4 Anticipatory skeletons

|               |                                                  |
| ------------- | ------------------------------------------------ |
| **Trigger**   | Route navigation — via Next.js `loading.tsx`     |
| **Frequency** | Constantly. **This is the one users feel most.** |
| **Cost**      | ~1 day for the four main routes. Do it first.    |

There are **zero** `loading.tsx` files. Every navigation currently shows the old page until
the new one is ready.

Add `loading.tsx` at `desk/`, `desk/calendar/`, `desk/clients/[id]/` and
`desk/checkout/[appointmentId]/`, each rendering **the actual shape of the destination** —
the calendar's column headers and time gutter, the client record's header and safety strip —
not generic grey bars. A skeleton that matches the real layout makes the page feel like it
was already there.

```css
.skeleton {
  background: linear-gradient(
    90deg,
    rgb(var(--surface-alt)) 0%,
    rgb(var(--surface)) 50%,
    rgb(var(--surface-alt)) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.6s var(--ease-in-out) infinite;
}
@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
    background: rgb(var(--surface-alt));
  }
}
```

> **Note the existing keyframe is wrong for this.** `tailwind.config.ts` declares
> `shimmer: { '100%': { transform: 'translateX(100%)' } }`, which needs an absolutely
> positioned child element. Animating `background-position` on the skeleton itself is simpler
> and composites just as cheaply. Replace it — nothing uses it.

**Stagger arrival.** When real content lands, fade rows in with a 30ms-per-row delay, capped
at 8 rows (240ms total). Beyond that a list feels slow rather than lively.

```tsx
style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}  // with animate-settle-in
```

**Honest caveat:** skeletons that are slower than the data are worse than nothing. Measure
the routes first — if `deskDay` resolves in 80ms, a skeleton that flashes for 80ms is a
flicker. Use a 120ms delay before showing one.

---

### 3.5 Free wins — state feedback, not announcements

Outside the budget because none of these draw the eye:

- **Buttons lift 1px on hover, press down on active.** Already partly there
  (`active:translate-y-px`) — add the hover half. One class, product-wide.
- **Rows highlight on `hover` _and_ `focus-within`.** Keyboard users currently get nothing.
- **Inputs get a soft 3px focus halo** instead of a hard outline (§1.9).
- **Stylist chips scale to `0.97` on press.** Makes the filter feel physical.
- **A live NOW line** on the calendar, updated client-side each minute. Note `force-dynamic`
  renders once per request, so this must be a small client component computing from
  `Date.now()` — the server value is stale the moment it arrives.

---

## 4. Rollout, testing and risk

### 4.1 Phases

| Phase                   | Contents                                                                                                                                                                                          | Effort       | Ships alone?                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------- |
| **P0 — Tokens**         | §1.4 `globals.css` + §1.5 Tailwind diffs. Warmed neutrals, `ink-subtle` fix, `--field`, violet + coral, motion tokens, deepened shadows. Extend `palette.test.ts` (§1.6). Fix the 6 dead classes. | **2–3 d**    | Yes — invisible but everything depends on it |
| **P1 — Primitives**     | §1.9 Button / Card / Input / Badge / Stat. Radius language. Hover + press + focus.                                                                                                                | **3–4 d**    | Yes — lifts all 43 routes at once            |
| **P2 — Skeletons**      | §3.4 `loading.tsx` for the four main routes                                                                                                                                                       | **1 d**      | Yes — most-felt single change                |
| **P3 — POS**            | §2.4. Tip presets, the slot-collision bug, quantity, gift-card balance, receipt + rebook, the paid moment (§3.2)                                                                                  | **1–1.5 wk** | Yes                                          |
| **P4 — Client record**  | §2.3. Formula components query, safety strip, tabs, timeline promotion, formula lift (§3.3)                                                                                                       | **1–1.5 wk** | Yes                                          |
| **P5 — Calendar C1**    | Gutter bug, header offset, `colorHex` identity, lane-packing overlaps, density, NOW line, filter chips, touch targets                                                                             | **1 wk**     | Yes — best value/effort in the doc           |
| **P6 — Stylist day**    | Permission work + `/my-day` + per-stylist service queries                                                                                                                                         | **1.5–2 wk** | Yes                                          |
| **P7 — Photos**         | `AppointmentPhoto` migration + gallery + comparison slider                                                                                                                                        | **1.5 wk**   | Yes                                          |
| **P8 — Calendar C2/C3** | `rescheduleAppointmentAction` (§2.2, six constraints) + client island + drag + keyboard                                                                                                           | **3–4 wk**   | No — needs P5                                |

**Total ≈ 11–14 engineer-weeks.** Assumes one frontend engineer with backend support for
P6/P8, and that P8's scheduling work gets a reviewer who knows the solver.

**If you only get four weeks: P0 + P1 + P2 + P3 + P5.** That is warmed, verified tokens; real
component feedback; loading states; a POS that closes sales properly; and a colour-coded
diary with two bugs fixed. It will feel like a different product and it touches no scheduling
internals.

### 4.2 Testing

Existing gates (`pnpm verify`): `typecheck`, `lint`, `check:boundary`, `test:unit`,
`test:integration`, plus Playwright e2e and `test:contrast`.

**The good news, verified:** the e2e suite selects almost entirely by **accessible role and
name** — `getByRole('heading', { level: 1 })`, `getByRole('button', { name: /find a time/i })`,
`getByText(/copy this now/i)`. There are essentially no CSS or test-id selectors.

**Therefore:**

- ✅ **Restyling is safe.** Change classes, colours, shadows, spacing freely.
- ❌ **Changing copy breaks tests.** `Find a client`, `cut & finish`, `narrow it`,
  `copy this now` are all load-bearing strings.
- ❌ **Changing semantics breaks tests.** Keep the `<h1>` per page. Never convert a
  `<button>` to a `<div role="button">`. Keep `<li>` for list rows.

**Add:**

- The §1.6 palette assertions — non-negotiable, they close the gap that shipped a 4.44:1 token.
- A **hex-literal lint** over `src/**/*.tsx` (§1.6).
- Interaction tests for the drag state machine (§2.2) at the unit level, and **keyboard
  parity** e2e: every drag operation reachable by keyboard.
- Extend `deriveAccentLadder`'s `REQUIREMENTS` so the runtime tenant-branding half asserts
  the same pairs as the shipped half.
- `scripts/dev/screenshots.ts` already exists — use it as a cheap visual-diff baseline before
  P0.

### 4.3 What we are deliberately NOT doing

- **No dark mode.** `darkMode: []` is a committed decision. Adding it doubles every contrast
  assertion for a feature nobody asked for.
- **No drag-and-drop library.** §2.2.
- **No animation library.** Every effect in §3 is CSS. `framer-motion` would add ~34kB gzipped
  to buy nothing here.
- **No design-system rewrite.** No Radix migration, no headless-UI swap, no CSS-in-JS. The
  `cva` + `tailwind-merge` setup is fine.
- **No free-hex colour picker.** §1.3.
- **Not touching the consultation flow.** Out of scope and it is the strongest part of the app.

### 4.4 The three ways this fails

1. **It gets scoped as a re-skin.** Three of four screens need server work first (§0.1).
   _Mitigation:_ P0–P3 and P5 are genuinely UI-only and deliver most of the perceived change.
   Fund those first and let them prove the direction before committing to P8.

2. **"Vibrant" gets interpreted as saturation.** Someone lightens the primary to make it pop,
   `palette.test.ts` fails, and the fix becomes "loosen the test". My own first attempt at a
   brighter blue measured 4.16:1 and would have shipped a broken button.
   _Mitigation:_ the test is the contract. Every value in §1.2 is computed and passes. If a
   colour has to change, re-run the numbers — never the threshold.

3. **Drag-and-drop is half-built and abandoned.** It is 3–4 weeks with six real scheduling
   constraints (§2.2), and it is the most visible thing in the brief, so it attracts pressure
   to start early and cut corners.
   _Mitigation:_ P5 ships a much better calendar with **no drag at all**. Treat drag as a
   separate, later, properly-resourced project. A calendar that drags but double-books is far
   worse than one that does not drag.

---

## Appendix A — Bugs found during this audit

Independent of the redesign. Worth fixing regardless.

### A1 — Calendar time gutter misaligns (visual, severe)

`desk/calendar/page.tsx:111-124`. The hour labels carry the class `absolute` but an inline
`style={{ position: 'relative', marginTop: … }}`. **Inline style wins**, so the labels sit in
normal flow and their `marginTop` offsets **accumulate** instead of measuring from the
container top.

Measured in Chromium against a faithful reproduction:

| Hour  | Expected top | Actual top | Drift        |
| ----- | ------------ | ---------- | ------------ |
| 08:00 | 84px         | 92px       | +8px         |
| 12:00 | 420px        | 1,336px    | +916px       |
| 21:00 | 1,176px      | 9,047px    | **+7,871px** |

The gutter renders ~7.7× taller than the 1,176px grid. Fix — match what the column hour rules
already do correctly:

```diff
   className="tabular absolute -translate-y-1/2 pl-2 text-label text-ink-subtle"
   style={{
-    marginTop: (minute - startMin) * PIXELS_PER_MIN,
-    position: 'relative',
+    top: (minute - startMin) * PIXELS_PER_MIN,
   }}
```

…and give the gutter `className="relative w-16 shrink-0 border-r border-line"`.

**Related:** even once fixed, the gutter has **no header spacer** while every stylist column
renders a `sticky top-0` name header first. The gutter's zero point sits ~37px (≈26 minutes)
above the grid's. Add a matching spacer.

**Also:** the `sticky top-0` stylist header is inert — `overflow-x-auto` on the wrapper makes
it the scroll container in both axes and it never scrolls vertically, so scrolling a long day
loses the stylist names entirely.

### A2 — `--ink-subtle` fails WCAG AA (accessibility)

`#77777F` measures **4.44:1** on canvas, 4.26:1 on surface, 4.07:1 on surface-alt, 3.77:1 on
blue-100 — against the 4.5:1 required for text. It is used as text in **67 places** including
12px copy in the hair timeline, photo-capture hints and question fields, plus every input
placeholder. `palette.test.ts:33` lists the token in the "must exist" array and **never
asserts its contrast**. Fix: `#696971` (§1.2) plus the assertions in §1.6.

### A3 — Input borders fail WCAG 1.4.11 (accessibility)

`--line` `#E6E7EB` is **1.24:1** on canvas; `--line-strong` `#D3D5DB` is 1.47:1. SC 1.4.11
requires 3:1 for visual information identifying UI components. An input delimited only by a
1.24:1 hairline is not identifiable. Fix: `--field` `#8A8A92` (§1.2, §1.9).

### A4 — `--blue-300` fails the branding ladder's own rule

`#85B3DB` is **2.22:1** on white. `contrast.ts:184` reads
`{ rung: 300, against: WHITE, min: AA_UI, label: 'the border rung against white' }` — 3:1 —
but `palette.test.ts` never asserts it. **So the shipped palette violates the rule its own
runtime ladder enforces on every tenant.**

Retune to `#5794CC` (**3.22:1** — the lightest value that clears it) and add the assertion.

**And drop the alpha on the secondary button.** `button.tsx` uses `border-blue-300/60`, which
composites over white to `#9ABFE0` — **1.93:1**, still failing even with the corrected token.
Use `border-blue-300` at full opacity.

### A5 — Tip / discount slot collision (money bug)

`till.tsx:445-469`. Tip and open-amount discount share one grid cell via a ternary. Selecting
an `OPEN` discount unmounts the tip input while `tip` remains in `billPayload` — **a tip typed
then hidden is silently applied to the bill.** Separate the cells; clear `tip` on unmount.

### A6 — Six dead CSS classes

These compile to nothing (no matching Tailwind key exists):

| Class                         | Files                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `bg-gold-soft`                | `join-waitlist.tsx:113`, `booking-flow.tsx:235`, `video-step.tsx:121`, `desk-booking.tsx:209` |
| `hover:file:bg-surface-muted` | `admin/imports/upload-form.tsx:104`                                                           |
| `rounded-card`                | `review/[id]/review-claim.tsx:70`                                                             |

Gold has no `soft` rung; `surface` has only `DEFAULT` and `alt`; `borderRadius` has no `card`.
Either add the tokens (and a contrast assertion if text sits on them) or fix the call sites.

### A7 — Declared-but-unimplemented capabilities

Not bugs, but they misrepresent what the product can do:

- `appointment.reschedule` and `appointment.forceSlot` — granted in `policy.ts:88,91`,
  `Appointment.version` exists for them, implemented nowhere.
- `appointment.viewOwn` and `report.viewOwn` — granted to every role, used by zero routes.
- `markProcessing` accepts and validates `untilMinutes` then **discards it** — there is no
  `processingUntil` column, so "these stylists are free right now" can never say for how long.
- `RetailProduct`, `ProductRecommendation`, `ClientProfile.tags`, `pronouns`,
  `preferredStylistId`, `lifetimeSpendCents` — all stored, none rendered.
- `src/app/page.tsx:21` advertises before-and-after photos; the model cannot represent them
  (§2.3).

---

## Appendix B — Verification method

Nothing in §1.2 is estimated. Contrast is computed with a WCAG 2.1 implementation matching
`src/domain/branding/contrast.ts`: linearise each sRGB channel
(`c ≤ 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`), luminance
`L = 0.2126R + 0.7152G + 0.0722B`, ratio `(L₁+0.05)/(L₂+0.05)`.

The five-hue ceiling in §1.3 comes from Viénot–Brettel–Mollon dichromat simulation
(sRGB → LMS via the Hunt-Pointer-Estevez matrices, the dichromat projection applied in LMS,
back to sRGB), then pairwise CIELAB ΔE under normal vision plus all three dichromacies, with
a ΔE ≥ 15 threshold for "distinguishable at chip size". Subsets were exhaustively searched
from k=8 down to k=3.

The A1 drift figures were measured in headless Chromium against a faithful reproduction of
the shipped markup, reading `getBoundingClientRect()` for every label and hour rule.
