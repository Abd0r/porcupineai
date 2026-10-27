export const WORKBENCH_RAIL = `
<aside class="work-rail" id="work-rail" aria-label="Task overview" hidden>
  <details class="rail-card" id="todos-panel" aria-labelledby="todos-title" open hidden><summary><h2 id="todos-title">Todos</h2><span id="todos-count"></span></summary><p id="todos-objective" class="rail-objective"></p><p id="todos-goal" class="rail-note" hidden></p><ol id="todos-list" class="todo-list"></ol></details>
  <details class="rail-card" id="workers-panel" aria-labelledby="workers-title" open hidden><summary><h2 id="workers-title">Subagents</h2><span id="workers-count"></span></summary><div id="workers-list" class="worker-list"></div></details>
</aside>`;

export const WORKBENCH_RAIL_STYLES = `
.main:has(.work-rail:not([hidden])) { grid-template-columns: minmax(0,1fr) 240px; }
.work-rail { grid-column: 2; grid-row: 2; min-width: 0; overflow: auto; padding: 22px 18px 22px 0; scrollbar-width: thin; }
.rail-card { padding: 16px 0; border-bottom: 1px solid var(--line-soft); }
.rail-card:first-child { padding-top: 0; }
.rail-card > summary { display: flex; align-items: center; gap: 10px; cursor: pointer; list-style: none; }
.rail-card > summary::-webkit-details-marker { display: none; }
.rail-card > summary::before { content: '›'; color: var(--quiet); transition: transform .18s ease; }
.rail-card[open] > summary { margin-bottom: 12px; }
.rail-card[open] > summary::before { transform: rotate(90deg); }
.rail-card > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 3px; }
.rail-card h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .09em; color: var(--quiet); font-weight: 550; margin: 0; }
.rail-card > summary > span { margin-left: auto; font-size: 10px; color: var(--quiet); }
.rail-objective { font-size: 12px; line-height: 1.6; font-weight: 500; color: var(--text); margin: 0 0 14px; overflow-wrap: anywhere; }
.rail-note { font-size: 11px; color: var(--quiet); line-height: 1.6; margin-bottom: 12px; }
.todo-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.todo-item { display: grid; grid-template-columns: 14px minmax(0,1fr); align-items: baseline; gap: 8px; font-size: 11px; line-height: 1.65; color: var(--muted); }
.todo-item .todo-symbol { font-size: 12px; color: var(--quiet); }
.todo-item[data-state="active"],.todo-item[data-state="verifying"] { color: var(--text); }
.todo-item[data-state="active"] .todo-symbol,.todo-item[data-state="verifying"] .todo-symbol { color: var(--accent); }
.todo-item[data-state="done"] .todo-text { text-decoration: line-through; color: var(--quiet); }
.todo-item[data-state="done"] .todo-symbol { color: var(--accent); }
.todo-item[data-state="blocked"] .todo-symbol,.todo-item[data-state="failed"] .todo-symbol { color: var(--danger); }
.worker-list { display: grid; gap: 18px; }
.worker { display: grid; grid-template-columns: 22px minmax(0,1fr); column-gap: 9px; row-gap: 6px; }
.worker-icon { grid-column: 1; grid-row: 1/4; color: var(--accent); padding-top: 1px; }
.worker-icon svg { width: 21px; height: 21px; overflow: visible; }
.worker-name { grid-column: 2; display: flex; align-items: baseline; gap: 8px; font-size: 11px; font-weight: 500; color: var(--text); }
.worker-state { margin-left: auto; color: var(--quiet); font-size: 10px; font-weight: 400; }
.worker-task,.worker-activity,.worker-result { grid-column: 2; margin: 0; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; color: var(--muted); }
.worker-task { color: var(--quiet); }
.worker[data-state="done"] .worker-icon { color: var(--quiet); }
.rail-toggle { border: 0; background: transparent; color: var(--quiet); padding: 6px 9px; font-size: 11px; border-radius: 7px; }
.rail-toggle[aria-expanded="true"] { color: var(--text); background: var(--surface); }
@media(max-width:1100px) {
  .main:has(.work-rail:not([hidden])) { grid-template-columns: minmax(0,1fr); }
  .work-rail { position: absolute; top: 62px; right: 14px; width: min(300px,calc(100% - 28px)); max-height: min(65dvh,600px); z-index: 9; padding: 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); box-shadow: 0 12px 40px rgb(0 0 0 / 15%); }
  .work-rail:not([data-open="true"]) { display: none; }
}
`;
