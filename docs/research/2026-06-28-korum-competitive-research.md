# Korum: research konkurencie, trendov a diferenciácie

Dátum: 2026-06-28  
Scope: read-only produktový research, bez implementácie a bez zmien v zdrojovom kóde.

## 1. Executive summary

Korum už má silné technické jadro: lokálny macOS spatial terminal workspace s infinite canvasom, xterm/Rust PTY terminálmi, poznámkami, read-only code windows, file tree, smart links, diffmi, agent statusom, war-room režimom a usage-limit trackingom. Produktovo je však stále viac "capable tool" než "okamžite pochopiteľný workflow". Najväčšia príležitosť nie je pridať generický chat alebo skopírovať celé agent orchestration platformy. Silnejší smer je:

> Korum makes AI coding work visible.

Prakticky: Korum by sa mal profilovať ako lokálny, bezpečný, priestorový cockpit pre vývojára, ktorý má naraz veľa terminálov a AI agentov. Konkurencia často ide do väčšej orchestrácie, workflow grafov, replayov, blueprints, worktree lanes alebo editorových funkcií. Korum má šancu odlíšiť sa tým, že zostane pokojnejší, macOS-native, lokálny a vizuálne silný.

Najvyššia priorita:

1. Zlepšiť prvý dojem: demo workspace/templates, screenshot-ready layout, lepšie onboarding affordance.
2. Urobiť existujúcu hodnotu zdieľateľnou: War Room Snapshot s redakciou citlivých dát, export layoutu, shareable recap.
3. Posilniť agent visibility: agent fleet radar, status timeline, waiting/busy filtre, worktree/session labels.
4. Doplniť navigáciu power-userov: command palette, global search, starred/stashed terminals.
5. Strategicky, ale opatrne: saved layouts/blueprints, review surfaces, limited session timeline/replay.

Neodporúčané teraz: full live multiplayer terminals, cloud sync scrollbacku, full IDE editor, veľká tile taxonómia, n8n-like automation builder, permanent wire-programming UX a auto-dispatch z externých inboxov.

## 2. Ako bol research rozdelený medzi agentov / workstreamy

Research bol rozdelený do piatich paralelných vetiev a následne syntetizovaný do tohto dokumentu:

| Workstream | Cieľ | Výsledok použitý v syntéze |
|---|---|---|
| Audit Korum | Preskúmať README, CLAUDE.md, changelog, `.claude/rules` a zdrojový kód | Aktuálny produkt je spatial terminal workspace, nie IDE ani cloud orchestrator |
| Konkurencia | Analyzovať `collabs-inc/collab-public`, `blueberrycongee/termcanvas`, `txc0ld/tmx` | Preniesť workflow affordances, nie celý rozsah konkurencie |
| Trendy/GitHub | Nájsť relevantné projekty v devtools, AI agents, canvas UI, workflow automation | Silný trend: agent operations, specs, review, code graph, visual workflows |
| Virálnosť/wow | Hľadať screenshot/video momenty a shareability | Najsilnejšie: War Room Snapshot, cinematic canvas export, agent radar, recap |
| Feasibility | Odhad náročnosti podľa aktuálnych modulov Korum | Quick wins sú hlavne vizuálne/exportné a onboardingové, replay/collaboration sú drahé |

## 3. Čo náš projekt aktuálne podľa auditu robí

Korum je lokálny macOS Tauri produkt pre vývojárov, ktorí organizujú veľa terminálov, agentov a súvisiacich artefaktov na canvase. Produktová veta v [README.md](../../README.md) je "Spatial terminal workspace for developers" a "All your terminals. One canvas." [CLAUDE.md](../../CLAUDE.md) opisuje produkt ako macOS-focused Tauri app s infinite canvasom, xterm.js terminálmi, notes, project file tree, read-only code windows a usage-limit trackingom.

Aktuálne schopnosti:

- Spatial canvas: pan/zoom, drag/resize, minimap, snapping, arrange grid, viewport culling a performance optimalizácie pre veľa okien. Relevantné sú [src/components/canvas/Canvas.tsx](../../src/components/canvas/Canvas.tsx), [src/lib/viewport.ts](../../src/lib/viewport.ts), [src/lib/window-snapping.ts](../../src/lib/window-snapping.ts).
- Terminály: xterm.js frontend, Rust PTY backend, oddelený PTY a xterm lifecycle, lazy hydration, replay buffer, flow control a raw byte streaming. Relevantné sú [src/components/canvas/TerminalWindow.tsx](../../src/components/canvas/TerminalWindow.tsx), [src/lib/xterm-session.ts](../../src/lib/xterm-session.ts), [src-tauri/src/pty.rs](../../src-tauri/src/pty.rs).
- Agent-aware workflow: Claude/Codex activity detection, status dots, sidebar/minimap signal, war-room focus mode, session-only status model. Relevantné sú [src-tauri/src/agent_status.rs](../../src-tauri/src/agent_status.rs), [src/lib/agent-status-store.ts](../../src/lib/agent-status-store.ts), [.claude/rules/agent-status.md](../../.claude/rules/agent-status.md).
- Terminal Smart Links: terminálový output vie otvárať URL a lokálne file paths do browsera alebo CodeWindow, vrátane diff režimu a line targetingu. Relevantné sú [src/lib/terminal-smart-links.ts](../../src/lib/terminal-smart-links.ts), [src/components/canvas/CodeWindow.tsx](../../src/components/canvas/CodeWindow.tsx).
- File/code workflow: file tree s git statusom, CRUD a active reveal, Shiki-based read-only code viewer s file/changes režimom a minimapou. Relevantné sú [src/components/layout/FileTree.tsx](../../src/components/layout/FileTree.tsx), [src-tauri/src/file_tree.rs](../../src-tauri/src/file_tree.rs), [src/lib/code-window-rendering.ts](../../src/lib/code-window-rendering.ts).
- Notes: markdown note windows, file-backed loading a preview safety. Relevantné sú [src/components/canvas/NoteWindow.tsx](../../src/components/canvas/NoteWindow.tsx), [.claude/rules/note-window.md](../../.claude/rules/note-window.md).
- Usage limits: Claude/Codex usage dashboard s cache, backoff a credential handlingom v Rust backend. Relevantné sú [src/components/layout/UsageLimitsCard.tsx](../../src/components/layout/UsageLimitsCard.tsx), [src-tauri/src/claude_usage.rs](../../src-tauri/src/claude_usage.rs), [src-tauri/src/codex_usage.rs](../../src-tauri/src/codex_usage.rs).

Silné stránky:

- Technický základ pre veľké sessions je nadpriemerne premyslený: viewport-aware mounting, staggered terminal attach, flow control a worker-backed code rendering.
- Lokálnosť a privacy model sú dôveryhodné: agent status neposiela raw session content do frontendu, credentials ostávajú backend-only, storage je lokálny.
- Canvas, minimap, tethers, smart links a code windows už vytvárajú vizuálny "work map" moment.

Slabé alebo nejasné miesta:

- Onboarding je tenký. README quickstart a empty state vysvetľujú ovládanie, ale nie "prečo spatial workflow" na konkrétnom príklade.
- Produktová komunikácia môže byť nejasná: "agent-aware" môže evokovať orchestráciu agentov, ale Korum v skutočnosti primárne monitoruje a organizuje CLI workflow.
- CodeWindow je read-only, čo je produktovo rozumné, ale treba to explicitne komunikovať, aby používateľ nečakal IDE editor.
- Notes sú skôr scratchpad než knowledge layer. Chýba fulltext, tags, backlinks, export/recap.
- Dokumentačný drift: `CLAUDE.md` ešte spomína `Channel<Vec<u8>>`, zatiaľ čo aktuálne pravidlá a kód používajú raw channel response; `.claude/rules/terminal-system.md` tiež referencuje experimentálne súbory, ktoré v aktuálnom strome nie sú.

## 4. Konkurenčné porovnanie

### Priami referenční konkurenti

| Produkt | Čo robí | Čo robí lepšie ako Korum | Čo robí horšie / riziko | Čo preniesť | Čomu sa vyhnúť |
|---|---|---|---|---|---|
| [Collaborator](https://github.com/collabs-inc/collab-public) | Lokálne agentic dev prostredie s terminálmi, files, notes, code/image tiles na infinite canvase | Silnejší file-as-object flow: drag files to canvas, image tiles, inline code/markdown editing, file tile lifecycle | Viac smeruje k IDE/editoru; Electron/multi-webview nie je Korum macOS/Tauri bet; menej usage/agent quota depth | Drag-file-to-canvas, image/screenshot tiles, recent files/feed, lepšie file tile lifecycle | Full Monaco editor, duplicita pravého terminal rosteru, generic cross-platform posture |
| [TermCanvas](https://github.com/blueberrycongee/termcanvas) | Terminal-first infinite canvas pre AI agentov okolo Project -> Worktree -> Terminal | Worktree model, session history/replay/resume, global search, command palette, usage dashboard, waypoints, pins/stash | Veľký rozsah a agent-system-heavy smer; môže pôsobiť menej pokojne; širšia cross-platform ambícia | Focus/overview toggle, starred/stashed terminals, waypoints, worktree grouping, status digest | Wholesale Hydra/orchestration, account/sync layer, full editor drawer |
| [TerminalX/tmx](https://txc0ld.github.io/tmx/) a [repo](https://github.com/txc0ld/tmx) | Canvas-native terminal pre agent orchestration s explicitným tile-to-tile dataflow | Najjasnejší automation/wiring model, snapshots, time travel, blueprints, veľa tile typov | Pôsobí čiastočne aspiratívne a veľmi široko; riziko clutteru; neon/industrial UI nesedí Korum tónu | Lightweight context pipes, selected-region blueprints, task inbox tile, local preview/browser tile, layout snapshots | 15 tile typov naraz, permanent wire programming, auto-dispatch externých inboxov, Docker/SSH/Kanban scope |

### Relevantné susedné projekty a trendy

| Projekt | Relevancia pre Korum | Prenositeľný pattern |
|---|---|---|
| [Orca](https://github.com/stablyai/orca) | Agent fleet workspace, parallel worktrees, terminal splits, usage tracking | Worktree lanes, compare-results flow, spatial agent/session cards |
| [hunk](https://github.com/modem-dev/hunk) | Review-first terminal diff viewer pre agent-authored changes | Agent diff review surface, inline review state, multi-file review flow |
| [OpenCode](https://github.com/anomalyco/opencode) | Open-source coding agent s rastúcou adopciou | Detectable agent kinds, plan/build mode labels, read-only planning sessions |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec) | Spec-driven development vrstva pre AI coding assistants | Viditeľný spec/task artefakt na canvase, prepájanie notes/terminals/code windows |
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp), [CodeGraph](https://github.com/colbymchenry/codegraph) | Local code intelligence, low-token structural queries, code graphs | Impact/context cards pri code windows, project graph overlay, agent context debugging |
| [DESIGN.md](https://github.com/google-labs-code/design.md) | Agent-readable design-system/project context | `WORKSPACE.md`/`AGENT.md`-style structured context pane |
| [Agent Native](https://github.com/BuilderIO/agent-native) | Jeden action model pre UI, agents, MCP, CLI, API | Command registry a agent-addressable Korum actions |
| [tldraw](https://github.com/tldraw/tldraw) | Mature infinite canvas SDK a AI/collaboration primitives | Canvas interaction patterns, custom shapes, shareable boards; nie nutne adoptovať engine |
| [xyflow / React Flow](https://github.com/xyflow/xyflow) | Node-based workflow UI, minimap, controls, edges | Workflow affordances pre opt-in local automations |
| [n8n](https://github.com/n8n-io/n8n), [Activepieces](https://github.com/activepieces/activepieces) | Visual workflow automation s AI/MCP integrations | Poučiť sa z automation UX, ale nepreberať celý Zapier-like rozsah |
| [Langflow](https://github.com/langflow-ai/langflow), [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Visual programming pre AI workflows | Graph execution, queued runs, partial reruns ako vzdialená inšpirácia |
| [apple/container](https://github.com/apple/container) | Mac-first local isolation pre dev runtime | Future per-workspace sandbox/worktree/runtime controls |

## 5. Feature gaps

### Must-have chýbajúce funkcie

| Gap | Prečo je dôležitý | Evidence | Impact | Effort | Risk | Type |
|---|---|---|---|---|---|---|
| Guided demo workspace / templates | Nový používateľ musí hneď vidieť, prečo canvas pomáha pri agent-heavy work | Korum empty state je tenký; konkurencia ukazuje bohaté canvas workflows | High | Low | Low | Quick win |
| Command palette a global search | Power-user devtool bez palette/search pôsobí nedokončene | TermCanvas má command palette/global search; Korum shortcuts sú skôr direct listeners | High | Medium | Medium | Strategic feature |
| Share/export snapshot | Produkt s vizuálnym canvasom potrebuje jednoduchý screenshot/video moment | Korum screenshot je silný; trend devtools virality cez short demos | High | Low-Medium | Medium | Quick win |
| Worktree/session grouping | AI agent users často pracujú v paralelných branches/worktrees | Orca/TermCanvas stavajú okolo worktrees; Korum už má workspace/session status | High | Medium | Medium | Strategic feature |
| Layout export/import | Reusable workspace patterns sú prirodzené pre spatial produkt | TerminalX má blueprints/snapshots; Korum má durable frontend state | Medium-High | Medium | Medium | Strategic feature |

### Diferenciátory

| Diferenciátor | Prejav v produkte | Prečo sedí Korum |
|---|---|---|
| War Room Snapshot | Jedno kliknutie vytvorí redacted screenshot aktívneho agent workroomu | Korum už má war-room, status dots, minimap, tethers a usage card |
| Agent Fleet Radar | Minimap/overlay zoskupí agents podľa working/waiting/idle, repo, worktree | Zosilňuje existujúci agent-status model bez čítania session contentu |
| Tethered Diff Constellations | Diff/code windows sa vizuálne zoskupia okolo terminálu/agenta, ktorý ich otvoril | Korum už má terminal-to-diff tethers a code windows |
| Usage Limit Flight Plan | Usage card povie, koľko "ťažkých agent runs" je bezpečné spustiť pred resetom | Korum má unikátne Claude/Codex usage tracking vedľa terminálov |
| Spatial Recap / Storyboard | Vybrané terminals, diffs, notes a usage stats sa zložia do recap boardu | Premieňa canvas z workspace na shareable artefakt |

### Nice-to-have

- Image/screenshot tile na canvase.
- Recent files/feed view v sidebar/file drawer.
- Browser/local preview tile pre localhost apps.
- Starred terminals a quick cycle.
- Notes tags alebo light backlinks.
- "Viewer not editor" microcopy a affordances.

### Zatiaľ slabé nápady

- Full IDE editing v CodeWindow.
- Full multiplayer control nad lokálnymi terminálmi.
- Cloud sync terminálového scrollbacku.
- Všeobecný visual automation builder.
- Veľká taxonómia tile typov pred validáciou základného workflow.

## 6. Čo používatelia pravdepodobne očakávajú

Pre spatial terminal workspace:

- Rýchlosť a spoľahlivosť aj pri veľa termináloch.
- Perzistencia layoutu a terminálového kontextu po reštarte.
- Keyboard-first workflow: command palette, searchable actions, shortcuts.
- Rýchla navigácia: minimap, focus mode, search, jump to active/waiting sessions.
- Bezpečnosť: lokálne dáta, žiadne čítanie secretov, jasný privacy model.
- Jednoduchý prvý úspech: demo workspace alebo šablóna, nie prázdna plocha.

Pre AI-agent používateľov:

- Vidieť, ktorý agent pracuje, čaká alebo skončil.
- Rýchlo reviewnuť zmeny, ktoré agent spravil.
- Porovnať viac paralelných agent výstupov.
- Rozumieť usage limitom pred spustením ďalšej dávky práce.
- Udržať worktree/branch/task kontext bez mentálneho prepínania.
- Zdieľať "čo sa stalo" bez leaknutia shell outputu, pathov alebo tokenov.

Otvorené a slabšie podložené: presná cieľová persona. Z projektu vyplýva power-user developer s AI CLI agents, ale nie je jasné, či priorita je indie developer virálnosť, developer community virálnosť alebo B2B team workflow.

## 7. Virálne / wow nápady

| Nápad | Share moment | Evidence | Impact | Effort | Risk | Type |
|---|---|---|---|---|---|---|
| War Room Snapshot | Screenshot: aktívne agents, status colors, minimap radar, usage card, tethers, redaction | Korum má war-room/status/minimap/tethers; produkty ako Screen Studio/asciinema/VHS ukazujú silu exportov | High | Low | Medium | Quick win |
| Demo Workspace Templates | First-run canvas s "Multi-agent PR review", "Tauri release desk", "Incident command" | Korum onboarding je tenký; canvas produkty profitujú zo šablón | High | Low | Low | Quick win |
| Tethered Diff Constellations | Video: agent otvorí viac changed files, tie sa rozložia do mapy s tethers | Korum má Smart Links a diff tethers; hunk potvrdzuje review pain | High | Medium | Low | Quick win |
| Agent Fleet Radar | Overlay/minimap: working/waiting/idle agents ako mission control | Claude/Codex/OpenCode trend; Korum má privacy-conscious status store | High | Medium | Medium | Strategic feature |
| Cinematic Canvas Export | 10-20s pan/zoom cez workspace, ideálne pre X/YouTube Shorts | Spatial UI je prirodzene video-friendly | High | Medium | Medium | Strategic feature |
| Session Storyboard | Jeden recap board s notes, diffs, terminal highlights, usage | Obsidian/Milanote/tldraw pattern: board as artifact | High | Medium | Medium | Strategic feature |
| Layout Templates Gallery | Export/import sanitized layouts | TerminalX blueprints, Miro/Raycast-style sharing | Medium | Low-Medium | Low | Quick win |
| Usage Limit Flight Plan | "Safe to dispatch 2 more Codex agents" visual strip | Korum už má usage APIs; konkurencia nemá vždy túto vrstvu | Medium | Low | Medium | Quick win |
| Command Block Cards | Vybrané terminal command/output blocks sa dajú pin/copy/convert to note | Warp Blocks pattern, Korum terminal-first UX | Medium | Medium | Medium | Strategic feature |
| Lightweight Context Pipes | Explicitné linky: test failure -> agent terminal, diff -> review note | TerminalX wiring ako inšpirácia, ale len opt-in a úzko | Medium | High | Medium | Experiment |

## 8. Quick wins

| Quick win | Popis | Impact | Effort | Risk | Prečo teraz |
|---|---|---|---|---|---|
| Demo workspace seed | Lokálna šablóna bez auto-running commands: terminals as placeholders, note s príkladom workflow, code/diff windows | High | Low | Low | Zlepší activation a screenshot bez veľkého backendu |
| War Room Snapshot v1 | Export aktuálneho viewportu/canvasu s privacy blur/redaction toggles | High | Low-Medium | Medium | Využíva existujúci vizuálny moat |
| Visual polish pre screenshot-ready mode | Doladiť theme presets, status contrast, minimap/usage composition | Medium-High | Low | Low | Lacné a priamo podporuje virálnosť |
| Drag file to canvas | File tree drag vytvorí CodeWindow/Note/Image tile podľa typu | Medium-High | Low-Medium | Low | Konkurencia to má, Korum má file tree aj code windows |
| Recent files / changed files strip | Z file tree/git statusu vyrobiť rýchly feed pre changed/recent files | Medium | Medium | Low | Podporí agent review workflow |
| Status timeline lite | Session-only event list: working/waiting/idle transitions, bez raw scrollbacku | Medium-High | Medium | Medium | Silné demo, drží privacy hranicu |
| Star / focus terminal | Označiť dôležité terminály a rýchlo cyklovať | Medium | Low-Medium | Low | TermCanvas pin/stash pattern, dobrý power-user feature |
| Doc drift cleanup | Zladiť CLAUDE.md/rules s aktuálnym raw streaming a súbormi | Medium | Low | Low | Znižuje budúce engineering chyby |

## 9. Väčšie strategické feature

| Feature | Popis | Impact | Effort | Risk | Type |
|---|---|---|---|---|---|
| Saved/shareable layouts | Versioned export/import sanitized layout packages, regenerate ids, strip PTY/session fields | High | Medium | Medium | Strategic feature |
| Agent Fleet Radar | Sidebar/minimap/overlay pre agents podľa statusu, provideru, workspace/worktree | High | Medium | Medium | Strategic feature |
| Command registry + palette | Jeden action model pre UI shortcuts, menu, palette a neskôr agent-addressable actions | High | Medium | Medium | Strategic feature |
| Worktree lanes | Workspace view grouping podľa git worktree/branch/task, plus per-lane terminals/diffs | High | Medium-High | Medium | Strategic feature |
| Review surface | Hunk-like review flow pre agent-authored diffs v CodeWindow: reviewed/comment/accept markers | High | Medium-High | Medium | Strategic feature |
| Spec/task artifact pane | OpenSpec/DESIGN.md style object na canvase prepájajúci notes, terminals, code windows | Medium-High | Medium | Medium | Strategic feature |
| Limited session timeline | Bezpečný timeline statusov, opened files, diffs, note changes; nie full PTY replay | Medium-High | Medium-High | Medium | Experiment |
| Cinematic export | Keyframed pan/zoom export, prípadne HTML/video | High | Medium-High | Medium-High | Experiment |
| Browser/local preview tile | Localhost preview ako canvas tile pre web-app development | Medium | Medium-High | Medium | Experiment |

## 10. Prioritizovaná roadmapa

### P0: 1-2 týždne, zvýšiť activation a demo value

| Task | Impact | Effort | Risk | Type |
|---|---|---|---|---|
| Demo Workspace v1 | High | Low | Low | Quick win |
| Screenshot-ready War Room Snapshot v1 | High | Low-Medium | Medium | Quick win |
| Visual polish/screenshot theme preset | Medium-High | Low | Low | Quick win |
| Doc drift cleanup | Medium | Low | Low | Quick win |
| Explicit "CodeWindow is viewer/review, not editor" affordance | Medium | Low | Low | Quick win |

### P1: 2-6 týždňov, upevniť spatial agent cockpit

| Task | Impact | Effort | Risk | Type |
|---|---|---|---|---|
| Drag file to canvas | Medium-High | Low-Medium | Low | Quick win |
| Layout export/import MVP | High | Medium | Medium | Strategic feature |
| Agent Fleet Radar v1 | High | Medium | Medium | Strategic feature |
| Status timeline lite | Medium-High | Medium | Medium | Strategic feature |
| Star/focus/stash terminal UX | Medium | Low-Medium | Low | Quick win |
| Command palette MVP | High | Medium | Medium | Strategic feature |

### P2: 6-12 týždňov, začať workflow platformu bez scope creepu

| Task | Impact | Effort | Risk | Type |
|---|---|---|---|---|
| Worktree lanes | High | Medium-High | Medium | Strategic feature |
| Agent diff review surface | High | Medium-High | Medium | Strategic feature |
| Spec/task artifact pane | Medium-High | Medium | Medium | Strategic feature |
| Session storyboard/recap | High | Medium | Medium | Strategic feature |
| Layout templates gallery | Medium-High | Medium | Low-Medium | Strategic feature |

### P3: neskôr, až po validácii

| Task | Impact | Effort | Risk | Type |
|---|---|---|---|---|
| Full terminal replay/time travel | High | High | High | Experiment |
| Cinematic video export | High | Medium-High | Medium-High | Experiment |
| Lightweight context pipes | Medium | High | Medium | Experiment |
| Browser/local preview tile | Medium | Medium-High | Medium | Experiment |
| Read-only share bundle / comment snapshot | Medium-High | High | High | Experiment |

## 11. Riziká a trade-offy

- Privacy vs shareability: najvirálnejšie features pracujú so screenshots, terminálmi a code snippets. Redaction, preview a lokálny export musia byť prvotriedne, nie dodatočný checkbox.
- Scope creep do IDE: full Monaco editing by konkuroval VS Code/Zed/Cursor a oslabil jasnú hodnotu Korum ako spatial cockpit.
- Scope creep do orchestrátora: Terminálové agents sú už schopné; Korum by ich malo zviditeľniť a organizovať, nie hneď nahradiť vlastným agent frameworkom.
- Performance: všetko, čo pridá timeline, replay, preview alebo overlay, musí rešpektovať existujúce pravidlá: status session-only, no raw scrollback persistence by default, imperative DOM projection pre statusy, viewport-aware rendering.
- Trust/distribution: unsigned macOS app znižuje dôveru pri nástroji, ktorý pracuje s terminálmi a projektmi. Podpisovanie/notarization je produktová vec, nie len release detail.
- Copying trap: konkurencia má veľa lákavých tile typov a wiring modelov, ale Korum by malo najprv vyhrať jednoduchý "I can see my AI work" moment.
- Target persona uncertainty: bez používateľského feedbacku nie je jasné, či optimalizovať pre solo power users, indie hackers, agent-heavy agencies alebo malé engineering tímy.

## 12. Nápady, ktoré zatiaľ neodporúčame

| Nápad | Prečo nie teraz |
|---|---|
| Full live multiplayer terminals | Vysoké riziko filesystem/credential access, PTY ownership, conflicts a security modelu |
| Public cloud sync scrollbacku | Príliš veľa secretov, pathov, tokenov a raw výstupu |
| Full IDE editor v CodeWindow | Rozriedi positioning, zvýši complexity, konkuruje silnejším editorom |
| 15+ tile typov naraz | Skôr noise než jasná diferenciácia |
| Permanent wire-programming UX | Vhodné ako experiment, nie default pre calm workspace |
| Auto-dispatch zo Slack/Gmail/Linear | Príliš veľa external state, auth a safety otázok |
| n8n-like automation builder | Korum by sa stal workflow platformou namiesto terminal workspace |
| WebGL/canvas terminal renderer | Existujúce pravidlá hovoria nepoužiť bez nameraného rendering problému |
| Full cloud account/sync layer | Nezapadá do aktuálneho local-first trust modelu |

## 13. Návrh ďalších implementačných taskov

1. Napísať one-page positioning: "Korum as local-first spatial cockpit for AI-heavy terminal work"; explicitne vylúčiť "IDE replacement" a "cloud orchestrator".
2. Implementačný task: Demo Workspace v1.
   - Seed local workspace so statickými oknami: terminal placeholders, note s workflow, CodeWindow sample, usage card visible.
   - Bez auto-running shell commands.
3. Implementačný task: War Room Snapshot v1.
   - Export viewport/canvas PNG.
   - Privacy toggles: blur terminal content, hide paths, hide usage details.
4. Implementačný task: Screenshot-ready theme preset.
   - Jeden polished preset pre marketing/demo.
   - Skontrolovať text contrast, minimap composition, tethers, status colors.
5. Implementačný task: Drag file to canvas.
   - File tree drag/drop vytvorí CodeWindow alebo NoteWindow.
   - Image tile len ak sa scope potvrdí.
6. Implementačný task: Layout export/import MVP.
   - Export selected workspace layout JSON.
   - Strip `ptyId`, transient target fields, terminal snapshots a absolute paths podľa režimu.
   - Import regenerate ids.
7. Implementačný task: Agent Fleet Radar v1.
   - Overlay alebo expanded minimap so status groups.
   - Žiadny raw session content, len derived status.
8. Implementačný task: Status Timeline Lite.
   - Session-only timeline status transitions a opened diff/code events.
   - Bez PTY replay a bez persistent raw output.
9. Implementačný task: Command registry + palette.
   - Najprv internal action registry.
   - Potom palette a hardcoded shortcuts zjednotiť nad action modelom.
10. Implementačný task: Agent Diff Review Surface.
    - CodeWindow changes mode doplniť review affordances: reviewed/unreviewed, comments later.
11. Implementačný task: Documentation drift cleanup.
    - Zladiť CLAUDE.md s raw terminal streamingom.
    - Odstrániť alebo označiť stale references na experimentálne súbory.
12. Research task: 5-8 user interviews alebo dogfooding diary.
    - Overiť, či top pain je "too many agents", "review chaos", "usage limits", "lost terminal context" alebo "shareable progress".

## 14. Zoznam zdrojov / repozitárov / referencií

### Lokálne zdroje

- [README.md](../../README.md)
- [CLAUDE.md](../../CLAUDE.md)
- [CHANGELOG.md](../../CHANGELOG.md)
- [src/App.tsx](../../src/App.tsx)
- [src/components/canvas/Canvas.tsx](../../src/components/canvas/Canvas.tsx)
- [src/components/canvas/TerminalWindow.tsx](../../src/components/canvas/TerminalWindow.tsx)
- [src/components/canvas/CodeWindow.tsx](../../src/components/canvas/CodeWindow.tsx)
- [src/components/layout/FileTree.tsx](../../src/components/layout/FileTree.tsx)
- [src/components/layout/UsageLimitsCard.tsx](../../src/components/layout/UsageLimitsCard.tsx)
- [src-tauri/src/pty.rs](../../src-tauri/src/pty.rs)
- [src-tauri/src/agent_status.rs](../../src-tauri/src/agent_status.rs)
- [src-tauri/src/file_tree.rs](../../src-tauri/src/file_tree.rs)
- [.claude/rules/canvas-engine.md](../../.claude/rules/canvas-engine.md)
- [.claude/rules/terminal-system.md](../../.claude/rules/terminal-system.md)
- [.claude/rules/agent-status.md](../../.claude/rules/agent-status.md)

### Konkurencia a referencie

- [collabs-inc/collab-public](https://github.com/collabs-inc/collab-public)
- [blueberrycongee/termcanvas](https://github.com/blueberrycongee/termcanvas)
- [TermCanvas user guide](https://github.com/blueberrycongee/termcanvas/blob/main/docs/user-guide.md)
- [txc0ld/tmx site](https://txc0ld.github.io/tmx/)
- [txc0ld/tmx repo](https://github.com/txc0ld/tmx)
- [tmx feature index](https://github.com/txc0ld/tmx/blob/main/docs/features/README.md)
- [tmx wiring overview](https://github.com/txc0ld/tmx/blob/main/docs/features/wiring/overview.md)
- [tmx snapshots](https://github.com/txc0ld/tmx/blob/main/docs/features/persistence/snapshots.md)
- [tmx blueprints](https://github.com/txc0ld/tmx/blob/main/docs/features/workflows/blueprints.md)

### Trendy a adjacent projekty

- [stablyai/orca](https://github.com/stablyai/orca)
- [modem-dev/hunk](https://github.com/modem-dev/hunk)
- [anomalyco/opencode](https://github.com/anomalyco/opencode)
- [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)
- [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)
- [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph)
- [google-labs-code/design.md](https://github.com/google-labs-code/design.md)
- [BuilderIO/agent-native](https://github.com/BuilderIO/agent-native)
- [tldraw/tldraw](https://github.com/tldraw/tldraw)
- [xyflow/xyflow](https://github.com/xyflow/xyflow)
- [n8n-io/n8n](https://github.com/n8n-io/n8n)
- [activepieces/activepieces](https://github.com/activepieces/activepieces)
- [langflow-ai/langflow](https://github.com/langflow-ai/langflow)
- [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI)
- [apple/container](https://github.com/apple/container)
- [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage)
- [wavetermdev/waveterm](https://github.com/wavetermdev/waveterm)
- [zed-industries/zed](https://github.com/zed-industries/zed)
- [Warp Blocks docs](https://docs.warp.dev/terminal/blocks/)
- [asciinema](https://asciinema.org/)
- [charmbracelet/vhs](https://github.com/charmbracelet/vhs)

