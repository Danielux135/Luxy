// una notificacion de Windows no aporta nada mientras Luxy esta delante y, en
// Electron, puede dejar los controles nativos sin responder tras robar el foco.
export function shouldShowDesktopNotification(input: {
  windowVisible: boolean;
  windowFocused: boolean;
}): boolean {
  return !input.windowVisible || !input.windowFocused;
}
