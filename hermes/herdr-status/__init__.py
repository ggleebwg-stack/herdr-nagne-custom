"""herdr-status: Hermes Agent reports its status to herdr with OSC 7501 (Program Status Protocol).

herdr lists a terminal as an agent only when its program reports a status; Claude Code and Codex
do it themselves, Hermes does not. This plugin sends the same report from Hermes' lifecycle hooks:

  pre_llm_call                     -> working   (a turn starts)
  approval prompt / clarify tool   -> blocked   (a person is needed)
  answered                         -> working
  on_session_end                   -> done      (fired at the end of every turn; idle if interrupted)
  start / exit                     -> idle / clear

It writes only when Hermes runs in a herdr terminal (HC_TERMINAL_ID is set), and straight to the
console (CONOUT$, /dev/tty) so Hermes' own screen output is untouched. Sub-agent turns are ignored:
their end must not mark the parent's turn done.
"""
from __future__ import annotations

import atexit
import os
import sys
import threading

try:
    from agent.session_client_env import bound_client_env
except ImportError:  # Hermes before the shared gateway: each pane runs its own process
    bound_client_env = None

APP = "hermes"
_lock = threading.Lock()
_children: set[str] = set()


def _this_pane() -> bool:
    """True when this process's console is the herdr terminal the current session belongs to."""
    mine = os.environ.get("HC_TERMINAL_ID")
    if not mine:
        return False
    if bound_client_env is None:
        return True
    env = bound_client_env()
    # A shared gateway serves several panes; only the pane that owns this console may be told.
    return env is None or env.get("HC_TERMINAL_ID", mine) == mine


def _emit(state: str, kind: str = "") -> None:
    if not _this_pane():
        return
    fields = [f"state={state}"] + ([] if state == "clear" else [f"app={APP}"])
    if kind:
        fields.append(f"kind={kind}")
    seq = "\x1b]7501;" + ":".join(fields) + "\x1b\\"
    tty = "CONOUT$" if sys.platform == "win32" else "/dev/tty"
    with _lock:
        try:
            with open(tty, "w", encoding="utf-8") as f:
                f.write(seq)
                f.flush()
        except OSError:
            pass


def _is_child(session_id) -> bool:
    return bool(session_id) and session_id in _children


def _pre_llm_call(session_id=None, parent_session_id=None, **_):
    if parent_session_id:
        _children.add(session_id)
        return None
    _emit("working")
    return None


def _pre_tool_call(tool_name=None, session_id=None, **_):
    if tool_name == "clarify" and not _is_child(session_id):
        _emit("blocked", "question")
    return None


def _post_tool_call(tool_name=None, session_id=None, **_):
    if tool_name == "clarify" and not _is_child(session_id):
        _emit("working")


def _pre_approval_request(surface=None, **_):
    # "smart" approvals are decided by a model, not a person.
    if surface == "cli":
        _emit("blocked", "permission")


def _post_approval_response(surface=None, **_):
    if surface == "cli":
        _emit("working")


def _on_session_end(session_id=None, interrupted=False, **_):
    if _is_child(session_id):
        return
    _emit("idle" if interrupted else "done")


def register(ctx) -> None:
    ctx.register_hook("pre_llm_call", _pre_llm_call)
    ctx.register_hook("pre_tool_call", _pre_tool_call)
    ctx.register_hook("post_tool_call", _post_tool_call)
    ctx.register_hook("pre_approval_request", _pre_approval_request)
    ctx.register_hook("post_approval_response", _post_approval_response)
    ctx.register_hook("on_session_end", _on_session_end)
    _emit("idle")
    atexit.register(_emit, "clear")
