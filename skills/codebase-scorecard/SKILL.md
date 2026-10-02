---
name: codebase-scorecard
description: 'Use when the user asks for a graded report card / maturity assessment / quality score of the codebase: "score how well maintained this is", "rate the codebase 1-10 per area", "produce a scorecard", "how healthy is this code". Read-only: emits per-dimension scores, rationales, and recommendations, with every strength and weakness independently verified. For finding-and-fixing bugs use comprehensive-audit; for a security sweep use security-audit; for structural decomposition use decompose.'
---

# Codebase Scorecard

## Overview

A read-only, evidence-backed **report card** of the codebase across fixed quality
dimensions. Each dimension gets a 1–10 score with a citing rationale, verified
strengths, confirmed gaps, and concrete recommendations to raise the score.

## Core Principle

**No finding without evidence. No evidence without verification. No edits at
all.**

A score reflects *confirmed* strengths weighed against *confirmed* gaps. Never
inflate a score with an unverified strength, and never deflate it with an
unverified defect. Verify both.

**This skill never edits code.** Where the other audit skills stop at an
approval gate before touching anything, this one has no phase beyond the report:
there is nothing to approve because nothing is ever applied. Route fixes to
comprehensive-audit, security-audit, or decompose.

## Operating Rules

- Score only the in-scope dimensions (default: all 8). A run MAY be scoped to a
  dimension subset and/or a subtree via the user's argument (e.g.
  `security,testing` or `src/core`).
- Fan out: dispatch one discovery subagent per in-scope dimension in parallel,
  then one independent verifier subagent per dimension, then synthesize.
- Never edit code, never commit, never open a PR. Assessment only. **This bars
  *applying* a change to the repo, not experimenting with one.** Copy a
  module to a scratch dir and instrument it, run a checker at a wider scope,
  sandbox a mechanism outside the repo. Executing a probe beats reasoning about
  one, and the read-only rule is about the working tree, not about curiosity.
- Never run test suites. If a dimension needs coverage numbers, read existing
  coverage artifacts (e.g. coverage reports already on disk); do not execute
  tests. Running one *targeted* check, script, or scratch-copy experiment is not
  running the suite.
- Every score must cite the confirmed findings that produced it. No black-box
  numbers.
- Report only verified findings. A strength that fails falsification or a gap
  that is already handled does not appear and does not move the score.
- **The audit surface only ever grows.** Every check a prior run made is re-run
  by this run. See Continuity below. This is a hard input to the pipeline, not
  a best effort.

## Continuity: the coverage ratchet

Without this section, each run is a fresh team with no memory, and the score
measures *which questions this run's agents happened to ask* rather than the
state of the codebase. Observed effect over 13 runs of an earlier version: the
composite drifted 8.7 → 8.0 while the codebase strictly improved, because later
runs asked harder questions than earlier ones and nothing held the question set
steady.

State lives in **`~/.claude/scorecards/registry.md`**, beside the reports and
outside any repo. It has exactly three sections:

**1. Probes (append-only).** A probe is one named, mechanical check: a grep, a
script invocation, a count, a file existence test. Each row carries an id, the
dimension, the exact command or method, what a pass looks like, and the last
recorded result. **A probe is never deleted.** A probe that no longer applies is
marked `superseded: <reason>` and stays in the table.

**2. Open findings.** Confirmed gaps from prior runs that were not fixed, each
with its severity, the run that raised it, and, for High and Medium, **the fix
sketch its verifier drafted**. The sketch is the most valuable thing in this
file: it is what stops the next run re-deriving the same change from scratch,
and it is what a remediation plan starts from.

**3. Settled.** Findings that were retracted, proved false positives, or were
accepted as documented risk, each with the reason and the run that settled it.
**Do not re-litigate these.** Re-deriving a known false positive is the single
biggest waste of a run's budget.

### Cost control: read this before you fan out

"The surface only grows" applies to the *question set*, not to the effort per
question. Do not re-run full adversarial discovery on settled ground.

| Carried item | This run's cost |
|---|---|
| Probe | Run the command. Record pass/fail. Seconds. |
| Open finding | Cheap re-check: is it still true? One file read or one grep. |
| Settled finding | Nothing. Do not investigate. |
| New territory | The full discovery → verification fan-out goes **here**. |

The ratchet makes each run *cheaper* per unit of coverage, not more expensive:
agents stop re-finding what is already known and push into ground no prior run
covered.

### Bootstrapping

If `registry.md` does not exist, this is run 1 for the ratchet: run the normal
pipeline, then write the registry from this run's findings in Stage 4. Say so in
the report.

## Dimensions (default 8)

Score each 1–10. Create a todo per in-scope dimension.

1. **Security**: authn/authz, secret handling, injection/SSRF/XSS/path
   traversal surfaces, token lifecycle, enforced security lint guards.
2. **Testing & coverage**: unit/integration/e2e presence, coverage of branches
   and error paths, fixtures, guard tests, gates in CI.
3. **Architecture & boundaries**: layering, module boundaries, dependency
   direction, cohesion, ADR adherence, absence of tangled responsibilities.
4. **Documentation & ADRs**: README/dev-guide accuracy, ADR coverage of real
   decisions, docstring coverage, docs-vs-implementation consistency.
5. **Error handling & observability**: consistent error types/status codes,
   logging/correlation, security-event logging, no swallowed exceptions.
6. **Performance**: N+1 queries, blocking ops, caching, resource leaks,
   algorithmic hot spots.
7. **Consistency & house-style adherence**: naming conventions, shared-infra
   adoption vs. reinvention, duplication, dead code, API-shape uniformity.
8. **Type-safety & API contracts**: typed models vs. loose dicts, typed API
   responses, enum use vs. bare strings, OpenAPI-vs-runtime agreement.

## Scoring Anchors (1–10)

Map each dimension onto these fixed anchors so scores are comparable across runs:

- **9–10** exemplary: enforced by automation (lint guards / CI); no notable
  confirmed gaps.
- **7–8** strong: minor confirmed gaps only.
- **5–6** adequate: several confirmed gaps or inconsistent adoption.
- **3–4** weak: significant confirmed problems.
- **1–2** poor / absent.

Derive the number from confirmed strengths weighed against severity-weighted
confirmed gaps, then map onto the anchor band. State the band and the driving
findings in the rationale.

## Severity Classification

Dimension scores are 1–10, but the individual gaps behind them carry the same
five levels the other audit skills use, so a gap found here reads the same as a
finding handed to comprehensive-audit, security-audit, or decompose:

| Level | Criteria |
|-------|----------|
| **CRITICAL** | Data loss or corruption, security breach, outage on a normal path |
| **HIGH** | Wrong results a user would act on, auth gap, crash on reachable input |
| **MEDIUM** | Wrong behavior under specific conditions, degradation, recoverable failure |
| **LOW** | Narrow edge case, missing best practice with no clear trigger |
| **INFO** | Hardening, clarity, defense-in-depth suggestions |

Severity weights the score; it does not set it. Two MEDIUM gaps and one HIGH are
not a formula, they are the evidence the rationale has to argue from.

## Overall Composite

Weighted average of the dimension scores:

- **Security ×2**, **Testing & coverage ×2**, every other dimension **×1**
  (total weight 10).

Report to one decimal (e.g. `Overall 7.4/10`) and state the weighting in the
report so the number is transparent. If a run scopes to a dimension subset,
compute the weighted average over the in-scope dimensions only and say so.

## Pipeline

### Stage 0: Load carried state (REQUIRED, before any fan-out)

1. Read `~/.claude/scorecards/registry.md`. If absent, see Bootstrapping.
2. Read the most recent `~/.claude/scorecards/*-scorecard.md` for the prior
   per-dimension scores. These are the **anchors** for Stage 3.
3. Partition the registry by dimension. Each dimension's slice (its probes, its
   open findings, its settled list) is an input to that dimension's discovery
   agent in Stage 1.

Do not skip to Stage 1 because the registry "looks stale" or the codebase "has
moved on". A stale probe that now fails is a finding, and it is exactly the
finding this mechanism exists to surface.

### Stage 1: Discovery (parallel, one subagent per in-scope dimension)

Each discovery agent's prompt MUST carry three blocks, in this order:

1. **PROBES TO RUN**: that dimension's probe rows, verbatim. The agent runs
   every one and reports pass/fail per probe id. This is not optional and not
   subject to the agent's judgement about relevance.
2. **OPEN FINDINGS TO RE-CHECK**: is each still true? `still-open` /
   `fixed` / `changed: <how>`.
3. **SETTLED, DO NOT INVESTIGATE**: the retracted and accepted-risk list, so
   the agent spends its budget on new ground instead of re-deriving it.

Then, and only then, the agent does new discovery. Each returns BOTH:

- **Strengths**: things the codebase does well for this dimension, each with a
  title, location(s), evidence (a real code path or artifact), and a
  load-bearing weight (how much it should count toward the score).
- **Weaknesses**: candidate gaps, each with a title, location(s), evidence, and
  a severity (Critical / High / Medium / Low).

…and, as the first two sections of their report:

- **Probe results**, one line per probe id: `PASS` / `FAIL` / `superseded`,
  with the observed value. A probe the agent could not run is `BLOCKED` with the
  reason; it is never silently dropped.
- **Carried finding status**, one line per open finding: `still-open` /
  `fixed` / `changed`, with the evidence checked.

Instruct each discovery subagent to look for evidence of *enforced* good
practice (lint guards, CI gates, ADRs). Enforced strengths weigh more than
incidental ones.

Every new mechanical check the agent runs during discovery is a **candidate
probe**. Have it return those too, in probe-row format. That is how the
registry grows.

### Stage 2: Verification (one INDEPENDENT verifier per dimension)

For each dimension dispatch a **separate** subagent (NOT the discovery agent)
that re-derives every finding from source:

- **Strengths get an adversarial *falsify-it* pass:** does the claimed guard /
  pattern / test actually exist? Is it actually enforced? Is it bypassable? A
  strength that cannot survive falsification is retracted or downgraded.
  **Attempt the bypass, don't reason about it**: write the evading code in a
  scratch copy and see whether the guard fires. "Looks bypassable" and
  "is bypassable" are different findings, and only one of them is evidence.
  For a guard that walks a tree, repoint its roots at an empty directory in the
  scratch copy: if it still passes, it is vacuous.
- **Weaknesses get a *rule-out-already-handled* pass:** is the defect real, or
  does an existing guard / caller / type / test / config already mitigate it?
  Re-open the cited source; do not rely on the discovery agent's summary.

Verdict per finding: **confirmed** (keep), **revised** (real but the
description/severity/weight was wrong, so correct it), or **retracted** (drop).
Only confirmed and revised findings feed scoring.

#### Draft the fix: required for every High and Medium gap

**A fix attempt is a strictly stronger falsifier than a re-read.** For each gap
the verifier is about to confirm at High or Medium, it must sketch the actual
change: the files, the real before/after, and what else moves. Not applied, just a
patch sketch in the report.

Three things fall out, and all three are the point:

- **The fix is a no-op → the finding was wrong.** RETRACT it. You cannot draft
  "add corpus floors to these 22 guards" without discovering they already have
  them.
- **The fix breaks something → that is the finding's real blast radius.** The
  guard it disturbs, the caller it orphans, the coverage it destroys. That
  belongs in the finding, not in a later surprise.
- **The fix is clean → the sketch is the plan.** Carry it into the registry so
  remediation starts from a verified sketch instead of re-deriving from scratch.

Scope it: High and Medium only. A Low does not earn a fix draft.

> **Why this rule exists.** On one run, 8 discovery + 8 verification
> agents produced a report; 6 agents then drafted the fixes. The drafting pass
> **falsified three confirmed findings, including the run's single
> highest-ranked lever, and found three real defects the audit missed**, among
> them a lint guard that returned different answers on different runs. The
> difference was not effort or model; it was that drafting a fix forces you to
> open every affected file, while verifying a finding only asks you to re-read
> the cited one.

This is not extra work. It is the remediation-planning work moved earlier, where
it can still change the score.

#### Exercise the mechanism through the caller's real path

A probe that reaches the mechanism by a route the real caller never takes has
verified something else. This is the single most productive failure mode to
guard against, because it produces *confident* wrong answers rather than
uncertain ones: you ran a command, you saw a result, and the result was about a
different object.

Four instances, all from a single remediation pass:

- **A monkeypatch that patched a different module object.** A test tree with no
  `__init__.py` has pytest import the module under one dotted name, while
  `pythonpath = ["."]` makes the same file reachable under a second, distinct
  one. Patching one of those strings changed a copy nothing was running.
  Verifying it by importing the module directly "confirmed" it worked, because
  a direct import resolves to the same object the probe patched. Only running
  it as a real pytest test exposed the split.
- **eslint scope read from globs instead of measured.** The question was whether
  a guard's file set is covered by a `no-console` rule. Reading the config's
  globs gives an answer; planting probe files at three different depths and
  running eslint gives the answer. They can differ, and only one is evidence.
- **A pre-commit "coverage hole" that was a mount option.** A hook reported
  `(no files to check) Skipped`, which reads as a filter that does not match.
  Running `pre-commit run <hook> --files <path>` reported *Failed*, and pre-commit
  only attempts a hook whose filter matched. The real cause was `/tmp` being
  mounted `noexec` in the scratch worktree, so a `language: system` hook script
  was not executable there. A finding about lint coverage was really a finding
  about a mount flag.
- **A count measured on one sweep and reported as the total.** The fixture
  walked every route twice (two different parameter values); the probe measured
  one pass. The number the assertion actually sees was double the number
  reported, and a docstring shipped claiming the smaller one.

The rule: **measure the quantity the assertion actually sees, from inside the
harness that runs it.** If the finding is about a pytest fixture, measure it in a
pytest run. If it is about a pre-commit hook, invoke pre-commit. If it is about a
lint rule's scope, run the linter on a planted file. Reading the configuration
tells you what someone intended; running it tells you what happens.

#### An anti-vacuity check must not derive its expectation from its subject

A guard that asserts "I scanned all three trees" by looping over the same tuple
that names the trees cannot detect that tuple shrinking. It will loop over
whatever survives and pass. The same shape recurs whenever a check's expected
value and its observed value come from one source:

```python
for d in SCAN_DIRS:                      # the tuple under test
    assert any(f.startswith(d) for f in scanned)   # ...checked against itself
```

Check against an independent literal, a filesystem read, or a canonical
constant the subject does not own. And note this generalises past scan roots: a
count floor derived from the corpus, an allowlist validated against itself, a
snapshot test regenerated from current output.

Two corollaries worth probing directly, because both have been found live:

- **A walk that reports "no offenders" must also prove it walked.** Repoint its
  roots at an empty tree; if it still passes, the finding is vacuity, not
  cleanliness.
- **A *bounded* walk must additionally prove it did not give up.** A depth cap,
  timeout, or result limit that silently returns "nothing found" on truncation
  reads downstream as a clean result. Assert the truncation count at zero *and*
  assert the walk reached a real depth: the first alone is satisfied by a walk
  that never descended.

#### Overstating a consequence is the same error as missing it

This skill teaches you to ask "the mechanism is broken, but does it bite?", and
that habit has its own failure mode: concluding *too fast* that a real defect is
inconsequential. On the same remediation, a controller recorded three
consecutive findings as "the audit overstated its impact"; independent review
falsified the third. The audit's figure had been right and the controller's
measurement was wrong (see the one-sweep error above), so a correct finding was
briefly written off as an overstatement.

Hold both directions to the same standard: a claim that a defect *does not*
bite needs the same reproduction, from the same real path, as a claim that it
does. "I could not reproduce the symptom" is a finding about your probe until
you have shown the probe can detect the symptom at all.

### Stage 3: Scoring (per dimension, anchored to the prior run)

**The prior run's score is the starting point, not a blank slate.** Score the
*delta*, then state the resulting number.

1. Start from the prior score for this dimension.
2. Move it **down** only for a confirmed gap that is genuinely new or genuinely
   worse: a probe that flipped PASS→FAIL, or a new confirmed High/Medium.
3. Move it **up** for a carried finding verified `fixed`, or a probe that
   flipped FAIL→PASS.
4. **If every probe still passes and nothing new was confirmed, the score does
   not move.** A dimension does not lose a point because this run's agents
   looked harder or phrased the bands more strictly.
5. State the delta and its cause in one line. `unchanged` is a valid, common,
   and correct outcome.

A first run for a dimension (no prior score) maps onto the Scoring Anchors
directly, as before.

**The anchors describe the codebase, not the audit's thoroughness.** If a
deeper instrument found a pre-existing condition that earlier runs missed, that
is a *newly-surfaced* gap, not a *new* gap: record it, and say in the delta line
whether the codebase changed or only the measurement did. Only the former should
move a score.

### Stage 4: Synthesis

- Assemble one report section per dimension (see Report Shape).
- Compute the weighted Overall Composite.
- Rank the **top 3 highest-leverage improvements** across all dimensions, the
  changes that move the most score for the least effort, and name the single
  biggest lever.
- **Rewrite `~/.claude/scorecards/registry.md`:**
  - **Probes:** every prior probe with its new result, **plus** every candidate
    probe promoted from this run. Never drop a row; mark obsolete ones
    `superseded: <reason>`.
  - **Open findings:** carried findings still open, plus this run's confirmed
    gaps. Remove the ones verified `fixed` (note them in the report).
  - **Settled:** append everything this run retracted or accepted, with the
    reason and run date.
  - Probe count must be **≥ the prior run's**. If it is not, you dropped a
    probe: find it and put it back before writing the file.
- Write the markdown report and print the terminal summary table (see Output).

## Report Shape

Start with a summary table. The **Prev** and **Δ** columns are required whenever
a prior report exists:

```
Dimension                         Prev  Score    Δ
--------------------------------  ----  -----  ----
Security                           8/10  8/10     —
Testing & coverage                 6/10  7/10    +1
Architecture & boundaries          9/10  9/10     —
Documentation & ADRs               7/10  7/10     —
Error handling & observability     7/10  6/10    -1
Performance                        5/10  5/10     —
Consistency & house-style          8/10  8/10     —
Type-safety & API contracts        8/10  8/10     —
--------------------------------  ----  -----  ----
Overall (weighted)                 7.1   7.2   +0.1
```

Then a **coverage line** directly beneath it. This is the number that actually
trends, because unlike the score it cannot drift:

```
Coverage: 147 probes run (142 carried + 5 new), 3 FAIL · 12 open findings
(4 fixed this run) · 31 settled
```

Then one section per dimension:

```
## Security — 8/10 (prev 8/10, unchanged)
**Delta:** why it moved, or why it didn't. Name whether the codebase changed or
only the measurement did.
**Probes:** 18 run, 18 pass. (List any FAIL/BLOCKED explicitly.)
**Carried findings:** 2 still open, 1 fixed this run.
**Rationale:** why this number, citing the confirmed findings that drove it.
**Verified strengths:** each independently confirmed (falsify-it survivors —
say what bypass was attempted and how the guard responded).
**Confirmed gaps:** each with severity, newly-surfaced ones marked, and for
High/Medium the drafted fix (files + before/after + what else moves).
**Retracted this run:** findings whose fix draft turned out to be a no-op.
**To reach 9–10:** concrete, ordered recommendations.
```

The **Retracted this run** line is required even when empty. An audit that never
retracts anything is not falsifying hard enough, and a run of zeroes across
several dimensions is itself a signal to look at.

Close with an **Overall** section: the weighted composite, the top-3
highest-leverage improvements, and a one-line "biggest lever". Then the two
sections every audit skill in this set closes with, so a reader moving between
their reports finds the same things in the same places:

```
## Dismissed Findings (False Positives)

| Candidate | Why Dismissed | Evidence |
|-----------|--------------|----------|
| ... | ... | ... |

Everything retracted this run, plus anything the Settled section of the registry
turned away. This is the section that stops the next run re-deriving it.

## Recommendations

### Quick Wins (< 1 hour)
- ...

### Medium Effort (1 day)
- ...

### Larger Initiatives (1+ week)
- ...
```

## Output

- Write the full markdown report to `~/.claude/scorecards/YYYY-MM-DD-scorecard.md`
  (outside any repo; create the directory if needed). If the user names a
  different path, honor it.
- Write the updated `~/.claude/scorecards/registry.md` (see Stage 4). **A run
  that produces a report but no registry update has broken the ratchet for every
  future run**. It is not finished.
- Print the summary table and the coverage line to the terminal.
- Never output the full report inline. Always write to file first.
- Do NOT commit either file. Tell the user where they were written and that they
  are uncommitted so future runs can diff against them.

## Red Flags: You're Doing It Wrong

The process failures. Any one of these makes the run's number meaningless,
whatever the analysis underneath it was worth.

- Scoring from unverified findings, when the whole point is confirmed strengths
  against confirmed gaps
- A black-box number with no citing rationale
- Letting the same agent both discover and verify a dimension's findings
- **Editing code, committing, or "fixing"**: this skill is assessment-only, and
  it is the one skill in this set with no approval gate because it never reaches
  for one
- Running test suites for coverage instead of reading existing artifacts
- **Skipping Stage 0** and fanning out from a blank slate
- **Dropping a probe** because it looks irrelevant now
- **Re-deriving a settled finding** that the registry already turned away
- **Re-running full discovery over carried probes**: a probe is a command, not
  an investigation
- Finishing without rewriting the registry

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Praising a strength that no guard actually enforces | Run the falsify-it pass: write the code that evades the guard and watch what happens |
| Lowering a score because this run looked harder | A newly-surfaced pre-existing condition is a finding; only a change in the codebase moves the number |
| Confirming a High or Medium gap without drafting its fix | Re-reading the cited lines is how a wrong finding survives to the top of the report. Draft the change. |
| Reasoning about whether a guard is bypassable | Write the evading code and run it. A probe beats an argument. |
| Treating "assessment only" as "reading only" | Instrumenting a scratch copy is not editing the repo, and it is where the real defects turn up |
| Reaching a mechanism by a path the real caller never takes | Patching a dotted module the runner does not import, or reading a linter's globs instead of running it on a planted file, yields a confident wrong answer. Take the caller's path. |
| Measuring one pass of something the harness runs twice | Report the quantity the assertion sees, not the quantity one sweep produces |
| Accepting an anti-vacuity check that derives its expectation from its own subject | A loop over the tuple under test, or a floor computed from the corpus, passes by construction after the exact regression it exists to catch |
| Declaring a defect harmless without reproducing the harmlessness | "Could not reproduce the symptom" is a claim about your probe until the probe is shown able to detect that symptom |
| Marking a probe deleted rather than `superseded` | The row never leaves the table; the reason it stopped applying is the useful part |

## Parallel Execution Strategy

Two fan-outs per run, never one. Stage 1 dispatches one discovery subagent per
in-scope dimension; Stage 2 dispatches one **independent** verifier per
dimension, which must not be the agent that made the findings:

```
Discovery:  one agent per dimension  ─┐
                                      ├→ raw findings
Verification: one INDEPENDENT agent  ─┘   per dimension → confirmed / retracted
              per dimension                        → Stage 3 scoring
```

An agent that verifies its own findings confirms them. That is the single
failure that turns this skill back into a vibe check with numbers on it. The
carried probes from Stage 0 are re-run inside the discovery pass at probe cost,
not investigated again. See Cost control.
