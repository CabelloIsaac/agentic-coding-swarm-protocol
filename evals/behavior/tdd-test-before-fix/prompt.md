---
description: "tdd writes the failing test before touching the code and runs it red then green"
tags: [behavior, tdd]
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

Users report that a discount above 100% gives a negative total in applyDiscount (src/discount.mjs). Fix it. Tests run with node --test.
