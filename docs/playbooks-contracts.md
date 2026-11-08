# Playbooks contracts: Phase A (v0.2, consolidated)

Status: agreed draft. Reviewed by wheelhouse-discuss (R1–R10) and firstmate-discuss (F1–F9); super-board review of §2 still pending. The final copy moves to the firstmate fork at `docs/contracts/` when `fm-pack.sh` lands.
Design: [playbooks-architecture.md](playbooks-architecture.md).

## 0. General rules
- Every output has `"schema"`, `"generated_at"` and `"fm_home"`.
- Readers ignore unknown fields. Adding a field needs no version bump; a breaking change goes to v2.
- **Read-only verbs** (list/show/resolve/diff/render-brief/version): a refusal is data in the JSON, exit 0. Non-zero only on a usage or IO error.
- **Mutating verbs** (install/apply): a refusal exits non-zero **and** prints the JSON.
- `fm-pack.sh` never runs project code. `verify_commands` are run only by workers or guarded scripts (the later `fm-merge-gate.sh`).

## 1. Layout

**Pack source:** pinned by `{repo, commit, path, tree_digest}`. Pack sources live on the orphan branch **`packs`** of `ROROZOA7/firstmate`, one dir per pack (`core/`). This keeps them out of Firstmate's code, lint and upstream syncs; the captain decided this on 2026-11-08.

```
<pack>/
  pack.yaml                    # manifest (§2)
  .claude-plugin/plugin.json   # {"name": "<pack name>", "version": "…"} → Claude namespace <pack>:<skill>
  skills/<skill>/SKILL.md      # vendored skills (+ references/, scripts/)
  policy/preamble.md           # worker preamble + decision ladder
  policy/fallbacks/<id>.md     # text fallbacks
  NOTICES.md                   # licence + attribution per vendored item
```

**Installed (immutable):** `data/.packs/<name>/<version>/<tree_digest>/`.
- **tree_digest** = sha256 over the sorted lines `<mode> <sha256> <relpath>\n`.
  - mode is 755 or 644
  - regular files only; no symlinks or hardlinks; nothing group/world-writable
  - at most 4096 entries / 64 MiB (the same rules as extension-bindings)
- If the tree no longer hashes to its dir name, the result is `digest-mismatch`.

**Binding** (captain-owned; Wheelhouse never writes it): `data/.pack-bindings/<project>.yaml`
```yaml
pack: core
version: 0.1.0              # display only; digest wins
digest: sha256:…
verify_commands:            # optional: REPLACES the pack default list (captain-owned)
  - {id: check, cmd: "npm run check"}
narrow:                     # narrowing only; widening keys are not representable
  skills_disable: [visual]
  verify_add: []
```
A repo-side `.firstmate/pack.yaml` (read from `origin/<default>`) may only narrow, and may never remove verify commands.

## 2. Manifest `pack.yaml` (schema fm-pack-manifest.v1)

```yaml
schema: fm-pack-manifest.v1
requires: {fm_pack: 1}
name: core
version: 0.1.0
description: Default worker playbook ported from super-board
harnesses: [claude, codex, opencode, pi]   # declared; resolve computes delivery itself
skills:
  vendored:
    - id: tdd
      provenance: {repo: github.com/<owner>/<repo>, commit: <sha>, license: MIT, path: <path>}
  allow_global: []            # non-vendored names allowed to resolve from global/plugins
  by_kind:
    bug:      {required: [diagnosing-bugs, tdd]}
    feature:  {required: [implement, tdd, codebase-design]}
    refactor: {required: [codebase-design, tdd]}
    docs:     {required: []}
  default:    {required: [diagnosing-bugs, implement, tdd, codebase-design]}   # literal list
  by_phase:
    build:  {required: [verification-before-completion, code-review], optional: [ponytail]}
    verify: {required: [tdd, testing-strategy, code-review, pr-security-review]}
    review: {required: [code-review, codebase-design]}
  conditional:
    - {id: vitest, when: "file:vitest.config.*"}   # v1 grammar: file:<glob> only, on origin/<default>
  fallbacks:
    - {for: ponytail, path: policy/fallbacks/simplest-solution-first.md}  # a fallback for a non-vendored skill implies allow_global
banned_tools: [AskUserQuestion]          # Phase B → permissions.deny
banned_skills: [grilling, shape, clarify]   # advisory only
preamble: policy/preamble.md
verify_commands:                          # pack default; a binding may replace it
  - {id: unit, cmd: "npm run test:unit"}
evidence:
  required: [verify_commands, decisions]
model_hint: null
settings: {}                              # reserved for Phase B; non-empty is refused in Phase A
```
- Required skills = `by_kind[kind]` ∪ `by_phase[*].required`.
- Each resolved skill carries `phase` ∈ `build|verify|review|task`.
- An unknown `when` grammar refuses with `unknown-condition`.

**Install refuses when:**
- the tree has symlinks
- the digest mismatches
- a vendored skill lacks `provenance.license`
- `settings` is non-empty
- `plugin.json` `name` ≠ `name`
- `requires` is unsupported

**Pilot binding (wheelhouse):** `verify_commands` = `npm run check`, `npm run lint`, `npm run test:unit`.

## 3. `fm-pack.sh` (schema fm-pack.v1, path `bin/fm-pack.sh` in the firstmate fork)

### version
`fm-pack.sh version --json` → `{schema, contracts:["fm-pack.v1","fm-pack-manifest.v1","fm-evidence.v1"], phase:"A"|"B"}`.

Wheelhouse checks it on start and every 10 min. `/api/health` reports `contracts:{…}`, and the Playbook / Ready / Evidence views are hidden when absent.

### list
`fm-pack.sh list --json` →
`{schema, packs:[{name, version, digest, source:{repo,commit,path}, installed_at, contents:{skills,hooks,mcp}, risk:["shell-hooks"|"network-mcp"|"shell-scripts"], update:{latest_commit,checked_at}|null, bound_projects:[{project, digest}]}]}`

### show
`fm-pack.sh show <name>[@<version>[#<digest>]] --json` → `{schema, manifest, digest, files:[path], notices}`.

Wheelhouse may read files directly under `data/.packs/<name>/<version>/<digest>/`; their realpath must stay inside that dir.

### resolve
`fm-pack.sh resolve <project> [--task <id>] [--harness <h>] [--kind <k>] --json` →

```json
{"schema":"fm-pack.v1","project":"wheelhouse",
 "binding":{"pack":"core","version":"0.1.0","digest":"sha256:…","binding_digest":"sha256:…"},
 "skills":[{"id":"tdd","name":"core:tdd","phase":"task","kinds":["bug","feature","refactor","default"],
            "source":"vendored","path":"<abs>","origin":"pack","state":"active",
            "conditional":null,"delivery":{"claude":"advisory","codex":"advisory","opencode":"advisory","pi":"advisory"}}],
 "banned":[{"id":"AskUserQuestion","kind":"tool","origin":"pack","delivery":{…}}],
 "hooks":[], "mcp":[], "settings_keys":[],
 "verify_commands":[{"id":"check","cmd":"npm run check","origin":"binding"}],
 "preamble":{"path":"<abs>/policy/preamble.md"},
 "model_hint":{"value":null,"owner":"dispatch"},
 "evidence":{"required":["verify_commands","decisions"]},
 "project_settings":{"mode":"no-mistakes","yolo":false,"branch_prefix":"fm/","forge":"github","pr_text_mode":null,
                     "merge_policy":null,"sandbox_floor":null,"owner":"captain"},
 "ignored":[{"item":"…","reason":"repo files may only narrow"}],
 "readiness":{"ok":true,"missing":[],"warnings":[],"refusals":[]}}
```

- **`delivery`** is per harness when `--harness` is omitted, and a plain string with a top-level `harness` when it's given.
  - Phase A: `advisory` for skills, banned, preamble and verify; `unsupported` for hooks, mcp and settings.
  - `enforced` arrives only in Phase B.
- **Kinds:**
  - Without `--kind`: every skill row is returned, with `kinds` and `conditional:{when, holds}`.
  - With `--kind`: only that kind's rows. The supervisor passes the kind at intake (label or classification); the default is `default`.
- **With `--task`:** adds `recorded_pack` and `drift:bool`.
- **`state`:** `active|disabled`. Disabled items stay listed.
- **`origin`:** `pack|binding|repo|global`.
- **Unbound project:** `binding:null`, `readiness:{ok:true, note:"no pack bound"}`, so today's behaviour is unchanged.
- **Readiness refusal codes:**
  - `missing-skill` (a vendored file is absent)
  - `no-verify-commands`
  - `secret-worktreeinclude` (`.worktreeinclude` on `origin/<default>` matches `.env*`, `*.pem`, `*.key`, `credentials*`)
  - `pack-not-installed`
  - `digest-mismatch`
  - `binding-invalid`
  - `unknown-condition`
- **Warnings:** `unverifiable` (allow_global visibility can't be checked in Phase A).

### diff
`fm-pack.sh diff <project> --to <name>@<version>#<digest> --json` →
`{schema, from, to, changes:[{kind:"skill"|"verify"|"preamble"|"hook"|"mcp"|"setting"|"banned", op:"add"|"remove"|"change", id, before?, after?, text_diff?}], risk_changes:[…], requires_captain:bool}`
- `requires_captain` is true when hooks, mcp, settings or banned change.
- `text_diff` is a unified diff, cut at 64 KB.

### render-brief
`fm-pack.sh render-brief <project> --kind <k> [--harness <h>]` → the `## Playbook` brief section (text). The fork may expose the same thing as `fm-brief.sh --pack <project>`.

### Supervisor-only (later)
- `install <repo> <commit> <path>`
- `apply <project> <name>@<version>#<digest> --expected-digest <binding_digest>`: refuses with `binding-changed` on a mismatch.

## 4. Brief section (Phase A)

The section is its own `## Playbook`. It never goes inside `## Firstmate spec` or the acceptance criteria, which no-mistakes passes as `--intent`.
```
## Playbook (pack core@0.1.0 #sha256:abcd…)
<preamble.md contents>
Skills — read and follow before the matching step (absolute paths):
- build: <abs>/skills/verification-before-completion/SKILL.md, …
- for this task (kind=feature): <abs>/skills/implement/SKILL.md, …
Banned tools: AskUserQuestion. Banned skills: grilling, shape, clarify.
Definition of done adds: run every verify command at your final head and record it in data/<task>/evidence.json.
- npm run check
- npm run lint
- npm run test:unit
```
- Record: `data/<task>/pack.json` = the resolve output frozen at spawn.
- The meta `pack=` line waits for Phase B (`fm-spawn --pack`, replayed on relaunch).
- Harnesses in a restricted sandbox can't write `data/<task>`. Note this in the brief.

## 5. evidence.json (schema fm-evidence.v1)

```json
{"schema":"fm-evidence.v1","task":"<id>","pack":"core@0.1.0#sha256:…","head_sha":"…","base_sha":"…",
 "verify_commands":[{"id":"unit","cmd":"npm run test:unit","exit":0,"skipped_reason":null,
                     "head_sha":"…","base_sha":"…","log_path":"<abs under data/<task>/>"}],
 "decisions":[{"rung":"repo-precedent","choice":"…","why":"…"}],
 "skills_used":["core:tdd"],"screenshots":[],"review_findings":[]}
```
- The top-level `head_sha` must equal the `done:` head.
- For a command that couldn't run, use `exit:null` plus a `skipped_reason`. Never a fake 0.
- `skills_used` is a claim and is never trusted.

## 6. fm-ready.v1 (later)
`fm-ready.sh [--project <p>] --json` →
`{schema, projects:[{project, watched_since, ready:[{issue,url,title,request_id}], sweep:[{issue,url}], blocked:[{issue,url,blocked_by}], flag:[{issue,url,reason}], invalid:[{issue,url,reasons:["no-ac"|"blocked-by-unparseable"]}], errors:[]}], quota:{graphql_remaining, halted}}`
- `request_id = <issue_url>@<ISO time it became ready>`.
- `fm-ready.sh version --json` is used for feature detection.

## 7. fm-issue-draft.v1 (later)
`{schema, project, drafts:[{draft_id, title, body_sections:{problem,context,fix,acceptance_criteria,risk,blocked_by,evidence}, labels, source:{kind:"scout"|"no-mistakes"|"review", ref}, dedupe:{fingerprint, matches:[issue_url]}}]}`
- `fingerprint = sha256(normalized title + source.ref)`.
