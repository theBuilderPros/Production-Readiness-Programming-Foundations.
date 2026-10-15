export function buildTrayMenu({ Menu, apps, onShowLauncher, onShowApp, onExit }) {
  const template = [
    { label: "Show Launcher", click: onShowLauncher },
    { type: "separator" },
    ...apps.map((app) => ({ label: `Show ${app.name}`, click: () => onShowApp(app.id) })),
    { type: "separator" },
    { label: "Exit", click: onExit },
  ];
  return Menu.buildFromTemplate(template);
}
