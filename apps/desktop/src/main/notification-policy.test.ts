import { describe, expect, it } from 'vitest';
import { shouldShowDesktopNotification } from './notification-policy.js';

describe('notificaciones de trabajos', () => {
  it('no abre un toast nativo encima de Luxy cuando la ventana esta activa', () => {
    expect(shouldShowDesktopNotification({ windowVisible: true, windowFocused: true })).toBe(false);
  });

  it('avisa cuando Luxy esta oculto o en segundo plano', () => {
    expect(shouldShowDesktopNotification({ windowVisible: false, windowFocused: false })).toBe(
      true,
    );
    expect(shouldShowDesktopNotification({ windowVisible: true, windowFocused: false })).toBe(true);
  });
});
