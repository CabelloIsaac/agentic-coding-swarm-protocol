---
description: "debug must fire"
tags: [trigger, debug, positive]
max_turns: 6
timeout_seconds: 240
allowed_tools: [Read, Glob, Grep, Skill]
---

test/invoice.test.ts fails about one run in five on CI and never locally. Find out why.
