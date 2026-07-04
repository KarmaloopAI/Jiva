# Design Guide

This guide documents Jivam's visual design system: color tokens, typography, spacing, component library, animation patterns, and special CSS utilities. Follow these conventions for all new UI work to maintain visual consistency.

---

## Color System

Colors are defined as CSS custom properties in `src/index.css`. The theme is toggled by setting `data-theme="dark"` on `<html>` — controlled by `useSettingsStore`.

**Never hardcode color values.** Always use the tokens below.

### Design Tokens

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--bg` | `#F5F3FF` | `#0A0A0B` | Page background |
| `--bg-secondary` | `#EDE9FE` | `#111113` | Secondary background areas |
| `--card` | `#FFFFFF` | `rgba(28,28,33,0.85)` | Card and panel surfaces |
| `--card-border` | `rgba(139,92,246,0.15)` | `rgba(139,92,246,0.20)` | Card borders |
| `--card-shadow` | `0 4px 24px rgba(139,92,246,0.08)` | `0 4px 24px rgba(139,92,246,0.15)` | Card shadows |
| `--text` | `#1E1B4B` | `#F5F3FF` | Primary text |
| `--text-muted` | `#6B7280` | `#9CA3AF` | Secondary / supporting text |
| `--text-subtle` | `#9CA3AF` | `#6B7280` | Placeholder and hint text |
| `--accent` | `#8B5CF6` | `#A78BFA` | Primary brand accent |
| `--accent-blue` | `#3B82F6` | `#60A5FA` | Secondary accent |
| `--accent-indigo` | `#6366F1` | `#818CF8` | Tertiary accent |
| `--input-bg` | `rgba(255,255,255,0.9)` | `rgba(28,28,33,0.9)` | Input field backgrounds |
| `--input-border` | `rgba(139,92,246,0.25)` | `rgba(139,92,246,0.35)` | Input borders |
| `--user-bubble-bg` | `linear-gradient(135deg,#8B5CF6,#3B82F6)` | `linear-gradient(135deg,#7C3AED,#2563EB)` | User message bubbles |
| `--agent-bubble-bg` | `#FFFFFF` | `rgba(28,28,33,0.9)` | Assistant message bubbles |
| `--agent-bubble-border` | `rgba(139,92,246,0.12)` | `rgba(139,92,246,0.20)` | Assistant bubble borders |
| `--topbar-bg` | `rgba(245,243,255,0.85)` | `rgba(10,10,11,0.9)` | Top bar background |
| `--topbar-border` | `rgba(139,92,246,0.12)` | `rgba(139,92,246,0.15)` | Top bar bottom border |
| `--sidebar-bg` | `rgba(255,255,255,0.95)` | `rgba(17,17,19,0.98)` | Sidebar background |
| `--scrollbar-thumb` | `rgba(139,92,246,0.3)` | `rgba(139,92,246,0.4)` | Scrollbar handle |
| `--code-bg` | `#F8F5FF` | `rgba(28,28,33,0.8)` | Code block background |
| `--code-border` | `rgba(139,92,246,0.12)` | `rgba(139,92,246,0.20)` | Code block border |

### Brand Colors (Fixed, Theme-Independent)

These are in `tailwind.config.js` and can be used as Tailwind classes:

| Name | Hex | Tailwind class example |
|------|-----|----------------------|
| `jivam-purple` | `#8B5CF6` | `bg-jivam-purple`, `text-jivam-purple` |
| `jivam-blue` | `#3B82F6` | `bg-jivam-blue`, `text-jivam-blue` |

---

## Typography

**Font:** `Inter` — loaded from Google Fonts in `src/index.css`. Fallback: `system-ui, sans-serif`.

```css
font-family: 'Inter', system-ui, sans-serif;
```

**Weights used:** 300 (light), 400 (regular), 500 (medium), 600 (semibold), 700 (bold).

**Scale:** Tailwind defaults. Common usage:

| Class | Size | Use |
|-------|------|-----|
| `text-xs` | 12px | Badges, captions, metadata |
| `text-sm` | 14px | Body text, list items, labels |
| `text-base` | 16px | Default (rarely used explicitly) |
| `text-lg` | 18px | Section headings |
| `text-2xl` | 24px | Screen titles (h1 in setup/splash) |

**Gradient text** — for brand headings only:

```html
<h1 class="gradient-text">Jivam</h1>
```

```css
.gradient-text {
  background: linear-gradient(135deg, var(--accent), var(--accent-blue));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

---

## Spacing & Layout

**App layout:** Fixed sidebar (240px) + `flex-1` main content area. Do not change these dimensions.

**Spacing scale:** Use Tailwind's scale. Preferred values:

| Use case | Class |
|----------|-------|
| Tight gap (icons, inline) | `gap-1`, `gap-2` |
| Standard gap (list items, cards) | `gap-3`, `gap-4` |
| Section spacing | `gap-6`, `gap-8` |
| Card padding | `p-4`, `px-4 py-3` |
| Panel padding | `p-6` |

**Border radius:** Prefer `rounded-xl` (12px) for cards and panels. Use `rounded-lg` for buttons and inputs. Use `rounded-full` only for avatars and dots.

---

## Utility Classes

These are defined in `src/index.css` and must be used as intended.

### `.glass-card`

The standard card surface. Applied to all floating panels, settings cards, and sidebar sections.

```css
.glass-card {
  background: var(--card);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--card-border);
  box-shadow: var(--card-shadow);
}
```

Usage: `<div className="glass-card rounded-xl p-4">`

### `.aurora-bg`

The animated purple-blue gradient orbs that appear behind all screens. **Always include on every top-level screen** — it is part of the brand identity.

```html
<div className="aurora-bg" />
```

It is `position: fixed; inset: 0; pointer-events: none; z-index: 0`. Content must have `position: relative; z-index: 10` (or higher) to appear above it.

### `.gradient-text`

See Typography section above.

### `.typing-dot`

Three animated dots used as a loading indicator:

```html
<div className="flex items-center gap-1.5">
  <span className="typing-dot" />
  <span className="typing-dot" />
  <span className="typing-dot" />
</div>
```

Dots bounce with staggered delays. Color uses `var(--accent)`.

### `.drag-region` / `.no-drag`

Controls window dragging via `-webkit-app-region`. Still relevant post-Electron-migration: Chrome/Edge/Brave `--app=` windows and installed Safari/Chrome web apps are frameless, and this CSS property is what makes a region of the page draggable like a native title bar in that context (it's a no-op in a normal browser tab). Apply `.drag-region` to the title bar area. Apply `.no-drag` to interactive elements within a drag region (buttons, inputs).

### `.markdown-body`

Applied to AI response content. Provides scoped prose styles for `h1-h4`, `p`, `ul/ol`, `code`, `pre`, `blockquote`, `table`, `a`, and `hr`. Uses `var(--code-bg)` and `var(--code-border)` for code blocks.

---

## Component Library

All interactive components live in `src/components/ui/`. **Always use these primitives — never write raw `<button>` or bare `<span>` elements in feature components.**

### `Button`

```tsx
import { Button } from '../ui/Button'

<Button variant="primary" size="md" onClick={handler}>
  <Icon size={14} />
  Label
</Button>
```

| Prop | Values | Default |
|------|--------|---------|
| `variant` | `primary` \| `secondary` \| `ghost` \| `danger` | `secondary` |
| `size` | `sm` \| `md` \| `lg` | `md` |
| `disabled` | `boolean` | `false` |

- `primary` — filled with `--accent` gradient, white text
- `secondary` — outlined with `--card-border`, `--text` text
- `ghost` — no border, transparent background, `--text-muted` text
- `danger` — red accent, used for destructive actions only

### `Badge`

```tsx
import { Badge } from '../ui/Badge'

<Badge variant="success">Connected</Badge>
```

| Prop | Values |
|------|--------|
| `variant` | `default` \| `success` \| `warning` \| `danger` \| `accent` |

---

## Animations (Framer Motion)

Jivam uses [Framer Motion](https://www.framer.com/motion/) for all transitions. Do not use CSS `transition` for enter/exit — use `AnimatePresence` + `motion.*`.

### Standard Page Entrance

```tsx
<motion.div
  initial={{ opacity: 0, y: 16 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.4 }}
>
```

### Staggered List Items

```tsx
{items.map((item, index) => (
  <motion.div
    key={item.id}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.08 }}
  >
```

### Collapse / Expand (Height Animation)

```tsx
<AnimatePresence>
  {expanded && (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
```

### Brand Pulse (Logo, Loading States)

```tsx
<motion.div
  animate={{ scale: [1, 1.04, 1] }}
  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
>
```

### Exit Transitions

Always wrap components that mount/unmount with `AnimatePresence` at the parent level:

```tsx
<AnimatePresence>
  {showPanel && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
```

---

## Scrollbars

Scrollbars are globally styled in `src/index.css`:

- Width: 6px
- Thumb: `var(--scrollbar-thumb)` (accent purple at 30-40% opacity)
- Track: transparent
- Hover: accent at 50% opacity

No additional classes needed — all scrollable elements inherit this automatically.

---

## Syntax Highlighting

Code blocks in AI responses use [highlight.js](https://highlightjs.org/). Theme overrides are in `src/index.css` under `.hljs`. Dark mode applies custom token colors:

| Token | Dark color |
|-------|-----------|
| Keywords | `#C084FC` (purple) |
| Strings | `#86EFAC` (green) |
| Comments | `#6B7280` (gray) |
| Numbers | `#FCA5A5` (red) |
| Functions | `#93C5FD` (blue) |

---

## Do's and Don'ts

**Do:**
- Use CSS custom properties for all colors
- Use `.glass-card` for all card surfaces
- Use `Button` and `Badge` primitives for all interactive elements
- Include `<div className="aurora-bg" />` on every full-screen view
- Use Framer Motion for enter/exit animations

**Don't:**
- Hardcode hex colors (use tokens)
- Write raw `<button>` elements
- Use CSS `display: none` for hiding — use `AnimatePresence` + conditional rendering
- Skip the aurora background on new screens
- Add scrollbar styles to individual elements (global styles handle it)
