export function resolveOpen({ state, appId, liveWindowIds }) {
  const stored = state[appId];
  if (stored !== undefined && liveWindowIds.includes(stored)) {
    return { action: "focus", windowId: stored, state };
  }
  const nextState = { ...state };
  if (stored !== undefined) delete nextState[appId];
  return { action: "create", state: nextState };
}

export function recordWindow(state, appId, windowId) {
  return { ...state, [appId]: windowId };
}

export function forgetWindow(state, appId) {
  const next = { ...state };
  delete next[appId];
  return next;
}
