# UI Structure Principles (Proximity, Alignment, Contrast)

## Purpose
This project uses structure-first UI rules:
- Group by spacing and hierarchy first.
- Use alignment for layout rhythm.
- Use contrast for emphasis and status.
- Use divider lines only as a fallback for dense data (tables, official printable documents).

## Source alignment
Applied from:
- Tailwind CSS utility-first layout practices (spacing scale, container rhythm, mobile-first responsive).
- Proximity and visual hierarchy guidance from the referenced Tailwind/UI learning sources.

## Locked implementation rules
1. `Card`, `panel`, `list row` defaults are shadow + surface contrast, not borders.
2. Lists use vertical spacing (`space-y-*`) and grouped cards (`group-item`) instead of separators.
3. Inputs use soft surface + inset emphasis; focus state uses ring/contrast, not thick borders.
4. Tabs and segmented controls rely on active background contrast, not underlines/dividers.
5. Error/success/info blocks rely on tone surfaces and iconography first.
6. Header/footer separators are avoided unless a dense information zone requires boundary support.
7. `hr` and border divider components are non-default and only introduced after readability tests fail with spacing/alignment alone.

## Shared classes
- `.cluster-list`: spacing-based list grouping.
- `.group-item`: neutral grouped row block.
- `.group-item-hover`: interaction state for grouped rows.
- `.contrast-panel`: emphasis block without divider usage.
- `.flow-stack-sm|md|lg`: vertical rhythm utilities.

## Fallback-only divider zones
Allowed line-based UI only for:
- Printable official documents.
- Dense tabular comparisons where row tracking is difficult without separators.
- Explicit legal forms that require bordered blocks.
