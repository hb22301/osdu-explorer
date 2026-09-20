---
name: Array table scrolling
description: Constraint for synchronized horizontal and vertical scrolling in the shared array-data viewer.
---

The element that owns vertical scrolling must contain the actual wide table directly. A generic table primitive with its own overflow wrapper hides the table's horizontal extent from the outer container and prevents a synchronized top scrollbar from appearing.

**Why:** The array viewer needs one horizontal extent for both scroll positions; nested overflow containers split the measurement and event ownership.

**How to apply:** When changing the shared array-data table, keep its semantic table inside the measured scroll container or explicitly synchronize the nested scroller instead.