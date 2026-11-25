# Product and experience

PM Signal is a small reference prototype for discussing how product teams could adopt AI in everyday work. It makes the experience and data boundaries concrete. The hypothesis is that useful workflows, personal control and aggregate feedback provide a better starting point than mandatory usage reporting. The prototype does not establish that this hypothesis improves adoption.

Read this guide for the product rationale and user experience. [Architecture](architecture.md) explains enforcement and analysis; [integrations](integrations.md) explains agent capture and storage setup.

- [Background and design principles](#background-and-design-principles)
- [Workspace and team view](#two-views-of-the-same-idea)
- [Editable workflows](#editable-workflows-and-guided-execution)
- [Privacy and local data](#privacy-is-part-of-the-workflow-experience)
- [Feature decisions and prototype scope](#deliberate-feature-boundaries)

## Background and design principles

Product leads want AI to improve research, requirements, design and decisions. Seat counts and prompt counts do not establish that improvement. Asking PMs to install a tool primarily so their manager can inspect their activity may create resistance or encourage visible actions aimed at meeting a metric.

The personal workspace therefore starts with practical workflow templates, before asking for recording. PMs can adapt the process to real work, keep feedback private and decide whether usage metadata contributes to team statistics. Declining recording never disables workflows or becomes an inferred low adoption score.

The intended entry flow is to configure the integration once, then open the local workspace. The current prototype can also start directly with `npm run dev`; native plugin installation and automatic agent execution remain unimplemented. Installing an integration does not enable telemetry.

## Two views of the same idea

| PM workspace | Team preview |
| --- | --- |
| Choose, adapt and execute six workflow templates | Inspect 13 named workflow categories and seven collaboration behaviors |
| Prepare step prompts and review results locally | Identify workflow gaps and opportunities for better guidance |
| Explicitly save a practice record or full local run snapshot | Read aggregate usage from consenting contributors |
| Review personal progress and optional private point feedback | No individual scores, private histories, task briefs or session content |
| Control telemetry, contribution and deletion | No agent-connection step or method-sharing counters |

The lead can use comparison, verification and revision patterns to discuss better templates, tools or practice time. Those patterns cannot independently establish quality, productivity, business impact or individual competence. Private scores use illustrative configurable rules, not validated performance measures.

Bundled member identities use synthetic numbered placeholders (`pm-01` / `PM 01`, and so on), rather than employee names or company rosters. Both views offer labeled **Demo insights** from synthetic data. **My recorded metadata** and **Shared aggregates** read stored metadata under the respective consent scope. The latter label means voluntarily contributed usage statistics, not a method-sharing feature.

## Editable workflows and guided execution

| Preset | Ordered process |
| --- | --- |
| Compare competitors | Scope → collect evidence → compare consistently → verify → recommend |
| Synthesize user feedback | Frame research → identify sourced themes → examine contradictions → plan follow-up |
| Review a PRD | Review scope → inspect flows and edge cases → make acceptance testable → propose revisions |
| Check a prototype | Define tasks → inspect complete flows → separate findings from assumptions → prioritize fixes |
| Plan an experiment | Form a hypothesis → design comparison → define metrics and guardrails → set a decision rule |
| Shape a roadmap | Define goals → examine evidence and estimates → explain trade-offs → define review triggers |

Each step supplies instructions, an expected result and review checks. Templates state required inputs and a final deliverable. **Edit workflow** lets PMs change these fields and add, remove or reorder steps. A template supports 1–12 steps, each with at least one review check; requiring a result is configurable.

**Save my version locally** creates a browser-local override and increments its version without modifying the bundled preset. **Save as a new template** assigns a new ID and preserves its PM category. **Reset to preset** removes an override. JSON import/export and **Agent workflow** Markdown export are local utilities, without team publication or synchronization. Exports exclude a run's brief and results, but authored template instructions may themselves contain sensitive information.

To execute a workflow:

1. Choose or adapt the template, add a business brief and select an agent.
2. Start the run. It pins the current template and version.
3. Copy the current step's instructions into the agent.
4. Bring the result back and confirm the review checks before advancing.
5. Continue with earlier reviewed results included in the next prompt's context.

Changing a result clears its confirmations. Reopening a step preserves its result, clears its review and invalidates later results and reviews. Editing the template library does not change a running snapshot.

This is a guided handoff, not an automatic model call. Clipboard content reaches an agent when the PM pastes it there, under that agent's own policy. Checking a box records the PM's review rather than independent validation. Completing a run does not automatically save a practice, award points, record telemetry or publish content.

## Privacy is part of the workflow experience

Installing an integration, using a workflow, saving locally and contributing statistics are distinct choices. **Private telemetry** and **Contribute to team usage statistics** both start off. Contribution requires telemetry, and turning telemetry off forces contribution off.

| Choice | New ingestion | Private past metadata | Team statistics |
| --- | --- | --- | --- |
| Telemetry off | Refused | Retained until deleted | Excluded |
| Telemetry on, contribution off | Allowed | Visible to owner | Excluded |
| Both on | Allowed | Visible to owner | Included subject to filters and cohort guard |
| Delete uploaded metadata | Disabled | Deleted for owner | Excluded |

This gives the PM a useful workspace even when they decline telemetry. The trade-off is incomplete team statistics representing only the consenting cohort. Missing records must not be interpreted as low adoption. Collected team counts are withheld below the default three-contributor threshold; that is a basic guard, not complete anonymity protection.

The capture handler has a separate excerpt-transfer option. Enabling telemetry does not by itself enable content transfer. Optional native capture may process permitted excerpts in the agent; the browser workflow engine never uploads its brief or returned results. See [integrations](integrations.md#agent-capture-and-consent) for capture settings and [architecture](architecture.md#consent-and-identity) for the enforcement boundary.

## Local saves and deletion

| Data | Location | Persistence |
| --- | --- | --- |
| Bundled templates | Static module | Included with prototype |
| Personal templates | Browser localStorage | Explicit save/import; up to 50 personal records |
| Active brief, results and checks | Browser memory | Lost on reload unless saved |
| Run snapshot | Browser localStorage | Separate checked confirmation and **Save this run locally**; up to 20 snapshots |
| Practice log | Browser localStorage | Explicit save of category and date only |
| Captured event metadata | Local JSONL or ES | Consent-gated ingestion |

A saved run includes its pinned template, brief, results, checks and progress. Saving again updates that snapshot; execution does not continuously autosave. Saved snapshots can be resumed or deleted. LocalStorage is scoped to the origin and browser profile; it is not encrypted storage or cross-device sync.

**Clear my local practice log**, **Clear saved workflow runs** and **Delete my uploaded data** are separate controls. Clearing snapshots leaves personal templates and the active in-memory run intact. Uploaded deletion disables telemetry/contribution and removes the exact owner's event metadata, preserving other members. Disabling recording alone retains private history until deletion.

## Deliberate feature boundaries

| Decision | Reason | Consequence |
| --- | --- | --- |
| Remove **Connect an agent** from both views | The intended entry follows one-time integration setup; asking again is redundant | Setup stays in integration documentation; the page does not claim a live connection |
| Remove **Share a useful method** | It submitted a category and self-reported assessment without a reusable method, adding reporting effort and encouraging performative check-ins | No sharing page, self-reported outcome counters or sharing APIs |
| Do not replace sharing with a team template library | Publication, ownership, access and sensitive-content review exceed the core reference scenario | Editing and file import/export remain local utilities |
| Keep recording and contribution separate | Personal learning and team analytics serve different needs | A PM can record private feedback without contributing team statistics |
| Keep scores private | Public rankings can reward superficial activity and increase monitoring concerns | Leads receive aggregate patterns, without PM scoreboards |

Removing method sharing does not remove optional team-statistics contribution. That setting governs inclusion of recorded metadata, not publication of a method or success declaration.

## Prototype scope and questions to investigate

Readers should be able to inspect both views, follow a workflow, change recording choices and understand how captured metadata reaches storage and statistics. Useful research would ask whether PMs find the templates relevant, can adapt and review them easily, understand the controls and would voluntarily return for another task. Leads could assess whether aggregate categories identify a concrete support need. These are questions to investigate, not results established by this prototype.

Production identity, native plugin packaging, automatic execution, cross-device sync, a team template library, semantic model recognition and validated impact measurement are outside the implemented scope. The service currently represents one configured local identity; its view switch previews experiences rather than authenticating or impersonating other PMs.
