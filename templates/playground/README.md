# playground/: experiments outside the system

This is where non-product experiments live: trying a library, a proof of concept or a one-off measurement. They are
versioned so the learning is not lost, but **they are not part of the system**. The full rules live in the ADR or
change that created this folder.

## Rules

- **Two kinds of folder:**
  - **Experiments:** `playground/<YYYY-MM-DD>-<slug>/`.
  - **Assignments:** `playground/<assignments>/<topic>-<YYYY-MM>/`, for one-off jobs done by hand or with in-house
    tools, such as a batch of marketing assets. Each assignment has its own `README.md` and `STATUS.md`.
- **One folder per experiment:** `playground/<YYYY-MM-DD>-<slug>/` (created by `pnpm playground:new <slug>`), with a
  `README.md` that has four sections: Question, What was tested, Result and Conclusion (or "discarded").
- **Outside the quality gates:** the folder is not in the pnpm workspace and Biome, `tsc` and Vitest do not check
  it. An experiment may have its own `package.json`: install it with `pnpm install --ignore-workspace`; its
  `node_modules` are not versioned.
- **The system never depends on an experiment:** nothing in `src`, `apps` or `scripts` imports or reads from
  `playground/`.
- **No secrets, and no real customer data outside assignments.** A business's real material (its brand, photos,
  offers) may live only inside the assignment that uses it. Heavy files (originals, deliverables, generated assets)
  stay out of git through the assignment's own `.gitignore`. Keys are read at runtime with
  `node --env-file=<main checkout>/.env`, and if the experiment spends money, only with the owner's OK and a note in
  its `README.md`. Mock or replay data and leftovers from test runs may be kept.
- **To bring something into the system**, open an OpenSpec change that rewrites the code under the repo's rules. The
  experiment stays here, with its conclusion linking to that change.
