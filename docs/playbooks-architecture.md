# Playbooks architecture: Firstmate + Wheelhouse, with super-board's strengths ported in

Status: **agreed design, not yet built** (2026-11-08)
Source: the design discussion between the super-board, wheelhouse and firstmate sessions. This document is the self-contained record.

## 1. Goal and decisions

**Goal:** keep Firstmate as the core that runs tasks across many projects, and give it control over *how* workers work. Today Firstmate dispatches a task and checks the result, but each worker just inherits whatever skills, plugins and MCP the global or project config happens to have. super-board (a GitHub-Projects software factory) has the clear worker method, ticket format and safety infrastructure that Firstmate lacks. It is **retired as a product** and used as a **donor**: its strengths are ported into Firstmate and Wheelhouse.

| Decision | Choice |
|---|---|
| Products kept | Firstmate (core, owns task/pack/intake/merge state) + Wheelhouse (UI; owns only its UI config: passages, plugins, vault, gateway) |
| super-board | Retired; skills, scripts and lessons are ported |
| Where core changes go | Forks: `ROROZOA7/firstmate`, `ROROZOA7/wheelhouse`. **Firstmate:** the fork must be `origin` (with `remote.origin.gh-resolved=base`), and `upstream` = kunchenguid/firstmate for pulling updates. Worker spawns, review diffs, landed-work checks and default-branch detection all use `origin`. `config/firstmate-role` = `maintainer github.com/rorozoa7/firstmate`, written by hand by the captain. **Wheelhouse:** remote `fork`; branches and PRs go there, never to `origin`. Offering changes back upstream is decided later, with per-task consent. |
| Firstmate fleet ledger | To enable (Step 0): `touch <home>/config/fleet-ledger` |
| Passages (per-project done/deploy checks) | Stay in Wheelhouse |
| Deployment | One primary Firstmate home on one machine (v1) |

## 2. Roles

```
             captain (user)
                  │  chat, decisions, consent clicks
                  ▼
 ┌──────────────── Wheelhouse (UI, read-mostly) ────────────────┐
 │ Playbooks catalog · Project ▸ Playbook tab · Task ▸ How it    │
 │ worked / Evidence · Ready queue · Findings→tickets · Radar    │
 └───────┬──────────────────────────────────────────▲───────────┘
         │ requests only: fm-inbox.sh note           │ reads: fm-* --json,
         │ (apply pack, install, file issues…)       │ snapshot, ledger, transcripts
         ▼                                           │
 ┌──────────── Firstmate (core, owns task state) ────┴──────────┐
 │ data/.packs/<name>/<ver>/<sha256>/  (immutable packs)         │
 │ data/.pack-bindings/<project>.yaml  (project → pack binding)  │
 │ readiness check → fm-spawn (+pack via launch flags) → worker  │
 │ evidence.json verification · Ready planner · merge gate       │
 └───────┬──────────────────────────────────────────────────────┘
         ▼
   workers (Claude / Codex / OpenCode / Pi) in treehouse worktrees
```

Invariants:
- **Firstmate owns all task, pack, binding, pack/GitHub-write consent, intake and merge state.** Wheelhouse owns only its own UI configuration: passages and their consent digests, `plugins.json`, the vault, gateway pairing, and its message record.
- **Toward Firstmate, Wheelhouse writes only via `fm-inbox.sh note`** or typed input into the session. It reads via versioned `--json` contracts plus the documented file reads in `docs/architecture.md` (ledger, `data/<id>/*`, inbox messages, transcripts).
- **Nothing is written into project worktrees or tracked project files.** Packs attach at launch (§4).
- **Outward-facing GitHub writes** (filing issues, comments) need per-project captain consent.
- **A pack never sets merge authority or delivery mode.** Those stay in `data/projects.md`, owned by the captain. Model choice stays with dispatch profiles (`config/crew-dispatch.json`); a pack may give only a *hint*.

## 3. The skill pack

### 3.1 Layout and pinning
- Catalog: `data/.packs/<name>/<version>/<sha256>/`. Dot-prefixed, because `data/<task-id>/` is the per-task dir and a task named `packs` would collide. Packs are content-addressed and immutable; each is pinned by source repo + commit **and** a tree digest. `install` mirrors extension-bindings' checks: no symlinks, tree digest, copy into `data/`.
- **Self-contained:** every required skill is vendored into the digest dir. Only skills on an explicit allowlist may refer to global or plugin skills. In Wheelhouse, adding a skill copies it into a new digest.
- Project binding: `data/.pack-bindings/<project>.yaml`. An optional repo-side `.firstmate/pack.yaml` is read from `origin/<default>` only (via `git show`), never from a worker's copy, and it may **narrow** policy only, never widen it.
- At spawn Firstmate records `pack=<name>@<version>#<digest>` in the task meta. Relaunch replays the same digest. Editing a pack publishes a new digest, so running workers are unaffected ("never patch skills mid-run"). A digest's files are garbage-collected only when no live or unlanded task references it. Its manifest is kept, so old tasks can still show their pack.
- **A pack can never loosen posture.** `fm-pack install` refuses a pack whose settings contain permission keys (`permissions.*`, `defaultMode`), sandbox keys, hook-disable keys (`disableAllHooks`) or `env`. Network access and the sandbox floor are per-project captain settings, not pack content.

### 3.2 Manifest `fm-pack.v1` (contents)
- `skills`: super-board's `super-board-skills-ready.py` REGISTRY turned into data, on two axes:
  - `skills.by_kind`: per task kind / label → required, conditional and optional skills (e.g. bug → diagnosing-bugs + tdd; feature → implement + tdd + codebase-design; refactor → codebase-design + tdd; docs → none).
  - `skills.by_phase`: build / verify / review, mapped onto no-mistakes steps. These are the per-lane boundary skills, e.g. build: ponytail, verification-before-completion, code-review; verify: tdd, diagnosing-bugs, testing-strategy, code-review, pr-security-review; review: code-review, codebase-design.
  - `skills.default`: for an unlabelled task, the union of the bug and feature rows until it is classified.
  - Conditional skills (vitest, playwright, resolving-merge-conflicts…) are vendored anyway, or resolved again at the moment of use.
  - `fallbacks`: text, not skills: `{id, path inside the pack}`. For example, missing ponytail → the "simplest-solution-first" section of the decision policy.
  - `provenance: {repo, commit, license}` per vendored skill. Most required skills are third-party (mattpocock-skills, ponytail, verification-before-completion, testing-strategy, vitest, playwright-best-practices; pr-security-review is MIT © Anthropic; visual carries THIRD_PARTY_NOTICES). Vendoring needs a licence check and attribution per skill.
- `banned`: interactive skills and tools: AskUserQuestion, grilling, shape, clarify, and their namespaced variants.
- `mcp`: MCP servers. `hooks`: guard hooks. `settings`: harness settings fragments.
- `verify_commands`: fed into the no-mistakes test step. There is **no second QA gate**.
- `preamble`: worker preamble and decision policy (§5).
- `model_hint`: input to dispatch only.
- `evidence`: the evidence schema the worker must fill in (§6).
- A ticket's `Skills:` line may override a kind's build row.
- Skill names are namespaced `<pack>:<skill>` on Claude only (the `--plugin-dir` convention). The namespace comes from `.claude-plugin/plugin.json`, whose `name` must equal the pack name. Codex, OpenCode and Pi have no namespace and use plain names or paths. The brief generator emits names from the manifest; nothing is hand-typed.

### 3.3 Layering
v1 is **additive**:
- Pack skills are namespaced and shadow nothing.
- Pack MCP servers are added, unless `--strict-mcp-config` is used (then only pack MCP plus Firstmate's own).
- Pack settings are merged into Firstmate's `--settings` overlay, which outranks user and project settings for the keys it sets.
- Firstmate's safety keys (permission posture, attribution-off, status/turn-end hooks, isolation assertion) are applied last. A pack key that collides with one is **refused**, not merged.
- The project's AGENTS.md/CLAUDE.md is always read.

A hermetic mode via `--setting-sources` (dropping user/project settings) is a separate, later option.

### 3.4 Readiness gate
Before spawning, the supervisor resolves the pack for the target harness and refuses with a list of missing skills **before** any worktree, claim or write. Because packs are self-contained, this mostly reduces to "the digest dir exists and the flag points at it". Allowlisted non-vendored skills are resolved with the same config the worker will get. The gate also refuses:
- a project whose `.worktreeinclude` matches secret patterns (`.env*`, `*.pem`, `*.key`, `credentials*`)
- a pack + project with no usable `verify_commands`: "the gate invents none", the equivalent of super-board's `super-board-verification-ready.py` exit 9. §8 depends on these commands.

A refusal preserves task, worktree and approval state. It is restarted explicitly, never retried automatically.
- Phase A (home-local): a supervisor pre-spawn step.
- Phase B (fork): a hard refusal inside `fm-spawn`.

## 4. How a pack reaches the worker (no worktree writes)

Why not install into the worktree: Firstmate never writes into worktrees; ship teardown refuses untracked files; `.git/info/exclude` is shared by every worktree (a worktree's `.git` is a file pointing at the shared common dir); pooled treehouse slots keep ignored files and would leak them into the next task; `AGENTS.md` is tracked.

| Harness | Mechanism (Phase B, fork change to `fm-spawn` launch templates) |
|---|---|
| Claude | `--plugin-dir <digest>` (skills/hooks/agents), `--mcp-config <digest>/mcp.json`, pack settings merged into the existing `--settings` overlay, the "When / Use / NEVER" steering table **appended to the existing `--append-system-prompt` value** (fm-spawn already uses it for the worker trust statement), banned tools via `permissions.deny` in the `--settings` overlay; optional `--strict-mcp-config` for hermetic workers |
| Codex | `-c` overrides for MCP servers; skills referenced by path in the brief; hooks stay disabled. The sandbox floor and `sandbox_workspace_write.network_access` come from the project's captain settings, never from the pack. The floor must add `writable_roots` for state/<task>.inbox, the status file, data/<task>/ and the clone's git common dir, and must be verified on a real worker before it becomes the floor. |
| OpenCode | merged into `OPENCODE_CONFIG_CONTENT` |
| Pi / omp | extra `-e` extension files |

**Phase A (home-local, before the fork change):** the pack is carried in the brief. `fm-brief.sh`'s Firstmate-spec section lists skills by absolute path, the preamble, and the verify commands in the definition of done. This is *advisory*: the worker reads and follows it. Wheelhouse shows each item as enforced / advisory / unsupported per harness, so it is always honest about what is actually enforced.

## 5. Worker preamble and decision policy (from super-build)
Injected into every brief:
- The worker is unattended and never addresses the captain. AskUserQuestion is banned (by brief text in Phase A, by `disallowedTools` in Phase B).
- Decision ladder: **Captain's intent / AC → repo precedent → smallest blast radius → human gate**. It never overrides the brief's Captain's intent.
- A human gate is reported as `needs-decision: [key=human-gate-<topic>] <reason>`, Firstmate's existing protocol. Each decision gets its own key, so open decisions don't collide.
- Decisions are recorded in `evidence.json` `decisions[]` (authoritative, since squash merges drop per-commit trailers). Optionally they also go in a commit trailer `Decision: <rung>: <choice> — <why>`, never a co-author line. The merge gate copies `decisions[]` into the squash body.
- TDD, simplest solution first.
- Docs first: **cite** the official doc URL used for third-party, auth or billing code.
- Keep each PR small, as super-build states the rule.
- **Never merge** and never run `gh pr merge`. Open a draft PR and stop.
- On failure, write a `root-cause-hash:` line in the handoff, so repeated identical failures are spotted.
- Rebuild pass: when a task comes back from verify or review, read every prior finding first and fix those before anything new.
- gh discipline: at most 50 gh calls per sub-agent; return `confidence: insufficient_data` when the budget runs out; report quota on exit.

## 6. Evidence (`data/<task>/evidence.json`)
- The worker writes it before `done:` to `data/<task>/evidence.json`. That dir is already an `--add-dir` grant for Claude workers; other harnesses need the same grant (see §4, Codex). Wheelhouse reads it via the snapshot or the file.
- It holds `skills_used`, `decisions[]`, `verify_commands[{cmd, exit, log_path, head_sha, base_sha}]`, `screenshots[]` and `review_findings[]`.
- Firstmate **verifies** what it can mechanically: the head matches, the verify commands are re-run or tied to no-mistakes/CI results at that head, and the referenced files exist.
- Self-reported fields (such as `skills_used`) remain *claims*: displayed, never trusted.
- Evidence never authorizes a merge.

## 7. Safety
- **Guard hooks** (from super-board): port only `guard-secrets`, `guard-key-literals` and `guard-delete-outside`. Firstmate already covers worktree path, unlanded work and protected push structurally.
  - Commands must use `${CLAUDE_PLUGIN_ROOT}` or absolute digest paths.
  - `guard-secrets` ships with its one sanctioned exception, `env-check.sh KEY…`, which prints present / empty / missing and never a value. Without it, workers can't check configuration at all. Its exception regex hardcodes `super-board-env-check.sh` (guard-secrets.py:31), so a rename must update the regex and `test-guard-hooks.sh` in the same change. The boundary is `CLAUDE_PROJECT_DIR`, which under `--plugin-dir` is the worker's cwd, i.e. the worktree (correct).
  - `guard-key-literals` is two hooks: PreToolUse blocks the write, PostToolUse flags a key already on disk. Both report line numbers only.
  - The delete-outside allowlist = worktree + `state/<task>.inbox` + `data/<task>` + `/tmp`, `/private/tmp`, `/var/folders` and `$TMPDIR` (needed on macOS). Firstmate's `.agents/skills` and `state/operational-inbox` are readable, never deletable. Worktree commits write into the clone's shared `.git`; that is not a violation. Known bypass: targets known only at run time (`$(…)`, or a variable set earlier in the same command).
  - Every hook **fails open** on its own errors, by design: a broken guard never parks unrelated work. Don't harden them to fail closed.
  - Port `tests/test-guard-hooks.sh` with the hooks.
- **Codex:** the `workspace-write` sandbox (plus the writable roots in §4) is the floor on pack projects. It is a per-project fork change. Network access is set per project in captain settings (§4), not by the pack.
- **Key-literal diff scan** runs for every harness inside the no-mistakes pipeline or CI.
- **Read boundary (known residual risk):** every worker runs as the operator's user and can read `~/.ssh`, `~/.aws` and the primary clone, whatever hooks or sandboxes are set. Mitigations:
  - keep real secrets out of clones and worktrees, and inject them per task through the launch environment
  - treat `guard-secrets` as defence in depth only
  - real isolation (separate OS user or container) is future work.

## 8. Merge gate (correctness fix)
`fm-pr-merge.sh` pins the head (`--expected-head`) and requires green checks, but it has **no cross-task merge lock per repository and no re-verify against the current base** (it refuses DIRTY but not BEHIND). This is ported from super-board's `merge-gate.sh` into the Firstmate fork:
1. Take a merge lock **per repository + base branch**, so merges in other projects aren't serialized behind this one's tests.
   - The lock is an atomic mkdir dir holding `pid`, `pr`, `fm_task`, `at` and a token or process start time, since a pid alone can be reused.
   - It uses two separate numbers: `lock-timeout` (how long a caller waits) and `stale-after` (when a held lock is presumed dead, default 5400 s). Otherwise a waiter could reap a lock that a slow verify legitimately holds.
2. Re-read the PR. If it's MERGED (with head = reviewed SHA), finish. If it's merged at another head, refuse with `merged-at-other-head`. If CLOSED, stop. If head ≠ reviewed, stop.
3. **Policy + approval first**, so a human-gated PR never spends a verify run inside the lock. A captain approval binds `{head_sha, policy plan}`; a changed plan voids it.
4. Scratch verify, done by a **guarded fork script** (`bin/fm-merge-gate.sh`), never by the supervisor by hand (hard rule: the supervisor runs no state-changing commands in project worktrees).
   - It leases a treehouse scratch copy, checks out the reviewed head SHA, merges `origin/<base>` into it (not into the base), runs `verify_commands` inside the lock, records the verified base and head sha, then runs `treehouse return`.
   - The commands come from the **pack digest recorded on the task**, not the current binding.
   - A merge conflict sends the task back to build for a rebase pass, not to Blocked.
5. Migrations: run the configured migrate command for each **allowed** env from the verified scratch tree. Collect every failure, without stopping at the first, and turn them into human-needed decisions.
6. Re-read the approval (body-declared human steps or config can change without a commit), and re-read the base head. If the base moved (e.g. a human merged outside the gate), re-verify. Then call `fm-pr-merge.sh <task> <url> --expected-head <sha> -- --squash --subject … --body …`.
7. Re-read the PR to classify the result: merged / queued / refused. If the result is unknown, retry only if the PR is still OPEN at the same head; otherwise halt. **Never retry blindly.**

Port `tests/test-merge-gate.sh`, `test_approval.py` and the merge-policy tests with the gate.

Both approval layers must pass: the captain's merge authority/yolo and the merge policy (money, auth, destructive schema, >400 lines, migrations only to allowed DBs → human). The merge policy (`auto_max_lines`, money/auth/schema patterns, `migrations.allowed_envs`, `human_steps`) is captain-owned, home-local Firstmate config in `config/merge-policy/<project>.json`, and is not part of the pack. It can only **add** escalations on top of Firstmate's existing ones (destructive, irreversible, security-sensitive), never authorize a merge. Escalations surface once, in the Firstmate inbox.

The gate writes ledger events `task.merge_queued` and `task.merge_refused{reason}` (Firstmate already writes `task.merged`). Wheelhouse maps refused → a "stuck" alert and queued → a badge. It lands in the fork first and is ranked the **first** change worth offering upstream (that needs per-task consent on kunchenguid).

## 9. Intake and issues (from super-collect, the ticket format and deps.sh)
- **Ticket schema** (Problem / Context / Fix / Acceptance Criteria / Risk / Blocked by [+ Evidence, Skills]) plus its parser live in Firstmate.
- **Blocked-by:** port `super-board-deps.sh`'s strict rules (last heading wins, latest `blocked-by:` comment first, an unreadable line is *flagged*, never treated as free), with `tests/test-deps.sh` and its fixtures. The rules encode real parsing failures, such as the backtick-quoted banner heading and to-tickets' "None — can start immediately". Firstmate's backlog deps use it.
- **Ticket valid** = has Acceptance Criteria + a parseable Blocked-by. Invalid tickets are surfaced, never skipped silently.
- **Ready planner** (`fm-ready.v1`): `ready[]` = watched + ticket-valid + no open blockers; `sweep[]` = blocked items re-readied once all their blockers close; `flag[]` = an unreadable Blocked-by, which needs a human (Wheelhouse alerts on it). It runs as a registered Firstmate watcher check (`fm-check-register.sh`, 300 s) plus `fm-inbox.sh note --request-id <issue_url>@<ready-time>`. It **replaces Wheelhouse's in-process `auto` issue intake** (`src/lib/server/issues/watch.ts`), so intake works while Wheelhouse is closed.
- **Findings → tickets** (`fm-issue-draft.v1`): Firstmate drafts from scout reports, no-mistakes findings and review threads, and dedupes against open issues. The captain edits and approves the drafts in Wheelhouse. Filing needs per-project consent.
- **super-collect, full port (later phase):**
  - external source plug-ins: Sentry; PostHog (exceptions, rage and dead clicks, failure events, web vitals, tracking gaps); GitHub issues; recurring problems in merged PRs and their review comments; architecture; custom MCP / HTTP / CLI sources
  - one fresh verifier per candidate (real? still happening? already fixed?)
  - fingerprint dedupe (`err|sentry|<id>`)
  - dry-run by default
  - 1–5 tickets → implement directly, 6+ → backlog
  - Intake credentials (Sentry, PostHog tokens) come from the Firstmate home's secret injection, **never a project `.env`**.
- **Milestone status comments:** optional, opt-in per project. One comment per task, edited in place, sent only on dispatched / PR ready / merged / blocked-needs-human.
- **GitHub quota discipline:** REST first, cached ids, back off below 200 GraphQL points remaining. Port `github-read.py`'s halt semantics: a required read that fails halts and keeps state (`github-halt.json`), and never degrades to a guess. Keep the measured price list (`rate-limit-etiquette.md`) as the justification. One wave once burned 2,850 of 5,000 GraphQL points on nested-field lookups. `card.sh` is board-specific and is dropped.
- **Writing standard:** commits `<emoji> [type] scope: subject` + bullets; PR bodies made of single-owner marker blocks; comments `[role] [label] status / Did / Done / Not done / Next`.
  - Mechanism: `pr-body.sh` rewrites ONE block, never the whole body. `pr-author-notes.md` covers inline review notes. `tests/test_writing_format.py` enforces the format.
  - To change a format, edit `writing-standard.md` first, then the templates and tests.

## 10. Wheelhouse
- **Playbooks catalog** (nav page): installed packs, source/commit/digest, update available, contents, risk flags (shell hooks, networked MCP).
- **Project ▸ Playbook tab:** two sections.
  - *Pack:* each item with its origin (home / repo-narrowed; widening attempts are shown struck through).
  - *Project settings:* delivery mode, yolo, merge policy, sandbox/network floor, branch prefix, forge, PR text mode (`pr=`). Captain-owned and read-only, with "change via Firstmate".
  - The tab also has the per-harness **enforced / advisory / unsupported** matrix and a version picker.
- **Diff + apply / install = requests:** Wheelhouse calls only the read-only subcommands (`list/show/resolve/diff`). Apply and install send an inbox note `{pack, version, digest, expected binding digest}` with an idempotency key. Firstmate's supervisor runs `apply`/`install` after confirming with the captain in chat for anything that changes hooks, MCP or settings. The screen shows "Waiting for Firstmate" until `fm-pack resolve` reports the new digest. Wheelhouse writes no Firstmate config.
- **Task ▸ How it worked:** a timeline of Skill calls, MCP calls, Bash commands, edits and subagents, with per-phase tokens. It is Claude-only behind a `TranscriptAdapter`, and shows names, counts and first lines only, never full tool output.
  - **Transcript matching:** in Phase A, transcript `cwd` = worktree **and** `gitBranch` = `fm/<id>`, within the task's dispatched→done window (worktree slots are pooled, so the path alone is not enough). In Phase B, the session id recorded in meta replaces this.
  - **Pack conformance:** "skill X available, never used"; "MCP Y called, not in pack"; plus a fleet roll-up. In Phase A a `Read` of `<digest>/skills/<name>/SKILL.md` counts as use. In Phase B it's a `Skill` tool_use of `<pack>:<skill>`.
- **Task ▸ Evidence:** claimed vs *verified* side by side. Unverified items are never green.
- **Ready queue tab, findings→tickets review, Blocked-by view** (read-only), **queued tasks' missing-skills list**.
- **github-issues plugin:** keeps `list` and `bell`. Its `auto` intake mode is removed (or disables itself when `fm-ready` is present), because the two intake paths use different request ids and would create duplicate tasks.
- **Feature detection:** every new contract is optional. `/api/health` lists which are available, and the Playbook, Ready and Evidence views are hidden when absent, so Wheelhouse still runs against upstream Firstmate.
- **Passages stay in Wheelhouse** (decision). They cover done/deployed observations. The Playbook tab sits beside Passage with no overlap. Merge policy is not shown as pack-owned.
- **History notice:** show "history is off" instead of an empty view when the ledger is disabled.

## 11. Contracts (define before UI)
All are versioned JSON; readers ignore unknown fields. All are optional, and consumers detect them (see §10).
- `fm-pack.v1`: `fm-pack.sh list | show <name> | resolve <project> [--task <id>] | diff <project> --to <name@ver#digest>` (read-only, callable by Wheelhouse) and `apply … --expected-digest <d> | install <repo> <commit>` (run only by Firstmate's supervisor).
- `fm-ready.v1`: `fm-ready.sh --json`
- `fm-issue-draft.v1`
- Snapshot/meta additions (fork): new: pack digest, transcript path / session id, readiness result. Existing: harness, model, account.
- Ledger additions (fork): `task.merge_queued`, `task.merge_refused{reason}`.
- Location: in Phase A, the new scripts live in the Firstmate fork's `bin/`, so Wheelhouse finds them the same way as the existing `fm-*` scripts.

## 12. Build order

**Step 0: setup.** Do this in order, while no workers are live, from the session holding Firstmate's fleet lock.
1. `touch <firstmate-home>/config/fleet-ledger`.
2. Firstmate remote layout per §1: `origin` = fork (`gh-resolved=base`), `upstream` = kunchenguid. The captain hand-writes `config/firstmate-role`.
3. Sync main: fetch; **merge** `upstream/main` into local main (this keeps the unpublished fix 211a22ae; no reset or rebase); run tests; push to fork main.
4. No self-update-source file is needed once `origin` is the fork.
5. Register the firstmate repo's delivery posture for fork work: no-mistakes, yolo off.

**Phase A: home-local / no core change (can start immediately)**
1. Agree the schemas for `fm-pack.v1`, `fm-ready.v1` and `fm-issue-draft.v1`.
2. Firstmate: the pack catalog plus `fm-pack list/show/resolve/diff`; inject the preamble through the brief; run the readiness check (skills + verify_commands) as a supervisor step. Port super-board's pieces into a first pack (see §14), each with its tests.
3. Wheelhouse: split `tasks/[id]/+page.svelte` into tab components; add the history-off notice.
4. Wheelhouse: a read-only Playbook tab and catalog (matrix shows *advisory*).
5. Wheelhouse: How it worked (Claude, matched by worktree + branch + time window).
6. Firstmate: the Ready planner check and ticket parser/deps. Wheelhouse: the Ready queue tab and removal of github-issues `auto` intake; then findings→tickets drafts.
7. Pack apply / install. Wheelhouse sends them as inbox-note requests. Firstmate adds `fm-pack apply/install` and the supervisor's confirm-with-captain handling.
8. **Pilot:** one project, one pack. Verify through How it worked / conformance that workers actually follow it.

**Phase B: fork core changes (firstmate fork)**
1. The fresh-base merge gate in front of `fm-pr-merge.sh` (§8).
2. Attach packs through launch flags per harness (§4), plus `disallowedTools`.
3. Record the pack digest, harness and session id in meta/snapshot.
4. A hard readiness refusal in `fm-spawn`.
5. Port the guard hooks into the launch overlay; a per-project Codex sandbox floor; the key-literal scan in the pipeline.
6. Verify `evidence.json`. Wheelhouse: the enforced matrix column, the pack on the task page, the evidence view.

**Later:** distinct exit codes in `fm-pr-merge.sh`; ledger events `task.validation_started` and `decision.opened/closed`; issue milestone comments; a "Pick up now" button; real worker isolation; multi-host; offering items back upstream.

## 13. Open items
- The exact pack name and contents of the first pilot pack, and which project pilots it.
- Per-project consent for GitHub writes (filing issues, comments), decided per project when enabled.
- super-board (`ROROZOA7/super-board`, itself a fork of `EricTechPro/super-board`): **do not delete it**. Pack provenance pins its commits. After porting, tag each source commit (e.g. `ported-to-firstmate-<date>`) and archive the repo read-only.

## 14. Porting list (from super-board)

| Piece | Action |
|---|---|
| super-build method + worker preamble + decision policy | Port the method into §5; strip the board glue |
| super-qa method | **Rewrite**: the 722-line SKILL.md is mostly bug-bash and board glue. Keep: re-run tests, check for test gaps, regression test at the layer where the defect lives, runtime and browser evidence (`runtime-verification.md`, `runtime_browser.mjs`, `runtime_compare.py`), bounce back with reasons |
| super-review method | Port: hypotheses before reading the summary, a re-review that rechecks every prior finding with file:line, an adversarial truth-check, shape problems filed rather than blocking, the over-engineering ladder |
| pr-security-review | Port as is (MIT © Anthropic, keep attribution) |
| git-sync, visual | Portable as is (visual keeps THIRD_PARTY_NOTICES) |
| ui-refine-loop | Claude-only, human-run (dynamic workflow): mark Claude-only or don't port |
| skills-ready REGISTRY, verification-ready | → `fm-pack.v1` + readiness gate (§3) |
| deps.sh, wave-plan (ready/sweep/flag), ticket format + lint | → Firstmate intake (§9) |
| merge-gate, merge-policy, approval | → Firstmate fork merge gate (§8) |
| github-read halt, gh-guard, rate-limit price list | → Firstmate quota discipline (§9) |
| guard-secrets (+env-check), guard-key-literals, guard-delete-outside | → pack hooks (§7) |
| writing-standard, pr-body.sh, pr-author-notes | → pack + Firstmate (§9) |
| 🙋 Block template | Maps to §5: `needs-decision: [key=human-gate-<topic>]` plus the exact command for the human. Not ported as is |
| super-collect | Later phase (§9) |
| host.sh | Drop the script, keep the facts for `fm-pack resolve`: CODEX_THREAD_ID, OPENCODE=1, CLAUDECODE leaks into nested hosts, so check innermost first |
| calibration, throttle/usage, onboard setup, agents-md, card.sh, wave/codex/claude-p dispatchers, guard-worktree-path, guard-protected-push, cleanup-wt | **Drop**. Firstmate covers these (quota-axi, treehouse, delivery pipeline, teardown) or they are board-specific |
| Tests | Port each piece's tests with that piece; `run-safety.sh` is the offline suite |
