# Documentation

PM Signal is a small reference prototype. Start with the [project overview and screenshots](../README.md), then read the three guides below in order.

| Guide | Questions it answers |
| --- | --- |
| [Product and experience](product.md) | Why this approach? What do the PM workspace and team view do? How do editable workflows, privacy choices and local saves fit together? |
| [Architecture](architecture.md) | How do the modules, APIs, consent gate, recognition rules and private scoring work? |
| [Integrations](integrations.md) | How do Claude Code, Codex and Copilot hooks attach? What does the collector do? How does the dashboard read ES-backed statistics? |

Agent integration and Elasticsearch belong to the same capture → store → read path. Personal workspace and privacy are part of the product experience, with their enforcement explained in architecture. Each guide owns those details rather than maintaining separate documents for every feature.

Saved interface previews are in [screenshots/](screenshots/). The team screenshot uses synthetic demo data; it is not a live Elasticsearch result. `npm run verify:browser` generates fresh previews in the ignored `artifacts/` directory. The README copies are `personal-workspace.png` → `screenshots/pm-workspace.png` and `team-improvement.png` → `screenshots/team-view.png`.
