---
version: 1.0.0
name: Multi-Tenant Chatbot System
description: A professional, minimal interface for AI analytics and fan engagement orchestration.
colors:
  canvas: "#FAFAFA"
  surface: "#FFFFFF"
  border: "#E4E4E7"
  brand: "#F59E0B"
  ink-950: "#09090B"
  ink-900: "#18181B"
  ink-500: "#71717A"
  ink-400: "#A1A1AA"
  ink-200: "#E4E4E7"
  success: "#10B981"
  alert: "#EF4444"
  purple: "#8B5CF6"
typography:
  sans:
    family: "Inter, sans-serif"
    weights: [300, 400, 500, 600]
  mono:
    family: "JetBrains Mono, monospace"
    weights: [400, 500]
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "999px"
components:
  nav-rail:
    width: "64px"
    position: "fixed-left"
    background: "surface"
  header:
    height: "auto"
    blur: "8px"
    border: "border/40"
  chat-bubbles:
    user: "bg-transparent"
    system: "bg-surface"
    padding: "16px"
  action-card:
    border: "brand"
    shadow: "elevated"
  status-pill:
    font: "mono"
    size: "10px"
    border: "ink-200"
motion:
  slide-up: "0.4s cubic-bezier(0.16, 1, 0.3, 1)"
  fade-in: "0.3s ease-out"
  pulse-slow: "3s infinite"
---
## Overview
The Multi-Tenant Chatbot console is a high-density intelligence environment. It prioritizes clarity, utilizing a grayscale foundation with high-contrast amber accents to highlight AI insights and actionable items.

## Colors
The palette is strictly utility-focused. `#FAFAFA` serves as the primary canvas, while the `ink` scale provides a range of text hierarchies from metadata to primary headers. The brand color `#F59E0B` is reserved for "Intelligence" states and primary calls to action.

## Typography
- **Primary Sans (Inter)**: Used for all UI controls, body text, and navigation elements. Tight tracking is preferred for headers.
- **Technical Mono (JetBrains Mono)**: Used for status indicators, timestamps, data IDs, and metric labels to imply systemic precision.

## Spacing
A strict 4px/8px grid system. Standard content padding is 24px (6 units) or 32px (8 units) for major viewport boundaries.

## Layout
- **Left Rail**: 64px fixed-width navigation for high-level app switching.
- **Sticky Header**: 90% opacity backdrop-blur header that persists during vertical chat scrolling.
- **Three-Layer Depth**: Background (Canvas), Middle (Surface Cards), Foreground (Modals/Tooltips).

## Elevation & Depth
- **Soft Shadow**: `0 2px 8px rgba(0,0,0,0.02)` for standard surface cards.
- **Elevated Shadow**: `0 8px 16px -4px rgba(0,0,0,0.04)` for hover states and actionable panels.
- **Glassmorphism**: Applied to headers and modal overlays using backdrop-blur (4px to 8px).

## Shapes
Use subtle rounding for a modern professional feel.
- **Buttons/Inputs**: 8px (lg) rounding.
- **Status Tags**: 4px (sm) rounding.
- **Main Containers**: 12px (xl) rounding.

## Components
- **Nav Rail**: Vertical column of 40x40px buttons with tooltips.
- **Intelligence Pipeline**: Vertical list of processing steps with animated opacity states (pending/active/done).
- **Action Shelves**: Distinctive cards with brand-color borders used for AI-generated recommendations.
- **Timeline Episodes**: Vertical line-connected items for historical auditing.
- **Data Health Progress**: Horizontal bars with gradient fills representing metric coverage.

## Motion
- **Entrance**: All new AI messages and modal windows must use `slide-up` combined with `fade-in`.
- **System Heartbeat**: Status indicators use `pulse-slow` to signify live data connections.
- **Transitions**: Color and border changes on hover should use `0.2s` or `0.3s` ease.

## Do's and Don'ts
- **Do**: Use JetBrains Mono for any value derived from a database.
- **Do**: Use high-contrast "ink-900" for user prompts to distinguish them from system output.
- **Don't**: Use brand colors for non-AI or non-critical actions.
- **Don't**: Use heavy borders; prefer light 1px lines or subtle shadow separation.

## Accessibility
- Ensure all text on `canvas` backgrounds meets a 4.5:1 contrast ratio using `ink-600` or higher.
- Interactive elements must have a `focus-visible` ring or clear background shift.
- Tooltips should be provided for all icon-only rail navigation.