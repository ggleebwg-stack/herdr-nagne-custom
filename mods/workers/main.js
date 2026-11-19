// Worker bar for the supervisor layout: lists sub-agents (terminals started with `hc run` by an agent)
// and pins the chosen one into the "watch-agent" block, so clicking your own pane never swaps it out.
// The watch column shows itself when the first worker appears and hides when the last one ends.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { terminals, layout, run, theme, checking } from "herdr";

const BLOCK = "watch-agent";
const COLUMN = "watch";
const RANK = { blocked: 4, error: 4, done: 3, working: 2, idle: 1 };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const workers = () =>
  terminals()
    .filter((t) => t.parent && t.state === "live")
    .sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0));

const shownAddress = () => find(layout(), BLOCK)?.content?.terminal ?? null;

// Herdr drops a terminal block from the layout when its terminal ends, so recreate it when missing.
function pin(address) {
  const tree = JSON.parse(JSON.stringify(layout()));
  const column = find(tree, COLUMN);
  if (!column) return;
  let block = find(tree, BLOCK);
  if (block?.content?.terminal === address) return;
  if (!block) {
    block = { id: BLOCK, type: "block" };
    column.children = [...(column.children ?? []), block];
  }
  block.content = { terminal: address };
  run("layout.set", { layout: tree });
}

export default class Workers extends View {
  init(_props, cx) {
    this.count = null;
    if (checking()) return;
    // Data sync, not animation: worker start/end needs no faster reaction than this.
    cx.timer.every(1500, () => this.sync());
    this.sync();
  }

  sync() {
    const list = workers();
    const shown = shownAddress();
    if (list.length && !list.some((w) => w.address === shown)) pin(list[0].address);
    if (this.count !== null && (this.count === 0) !== (list.length === 0)) {
      run(list.length ? "layout.show" : "layout.hide", { id: COLUMN });
    }
    this.count = list.length;
  }

  render() {
    const t = theme();
    const list = workers();
    const shown = shownAddress();
    const dot = (s) => ({ working: t.working, blocked: t.blocked, error: t.blocked, done: t.done }[s] ?? t.idle);
    // A small icon button on a chip; stops the press so the chip's own click (pin) doesn't fire.
    const button = (id, icon, title, act) =>
      div().id(id).flex_none().p(2).rounded(4).text_color(t.dim)
        .hover((s) => s.bg(t.raised).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); act(); })
        .child(svg(`mods/workers/${icon}.svg`).size(11));
    return h_flex().id("workers-root").size_full().px(8).gap(6).items_center().bg(t.chrome).text_size(12)
      .overflow_x_scroll()
      .child(div().text_color(t.muted).flex_none().child(list.length ? `Workers ${list.length}` : "No workers"))
      .children(list.map((w) => {
        const on = w.address === shown;
        return h_flex().id(`w-${w.address}`).flex_none().gap(6).items_center().pl(8).pr(4).py(3).rounded(6)
          .border(1).border_color(on ? t.accent : t.border).bg(on ? t.selected : t.surface)
          .hover((s) => s.bg(t.hover))
          .on_click(() => pin(w.address))
          .child(div().w(7).h(7).rounded(4).bg(dot(w.status)))
          .child(div().text_color(on ? t.foreground : t.muted).child(w.name ?? w.address))
          .child(div().text_color(t.dim).child(w.program?.name ?? ""))
          .child(button(`peek-${w.address}`, "terminal", "Peek", () => run("terminal.peek", { terminal: w.address })))
          .child(button(`kill-${w.address}`, "x", "Kill", () => run("terminal.kill", { terminal: w.address })));
      }));
  }
}
