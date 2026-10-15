export function createLifecycle() {
  let quitting = false;
  return {
    isQuitting: () => quitting,
    beginQuit: () => {
      quitting = true;
    },
    shouldHideOnClose: (kind) => kind === "launcher" && !quitting,
  };
}
