// @vitest-environment jsdom
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './shared';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ''; });

describe('Modal behaviour', () => {
  it('portals out of transformed ancestors, scrolls internally, traps/restores focus, closes on Escape', async () => {
    const host = document.createElement('div');
    host.style.transform = 'translateY(0)';
    const opener = document.createElement('button');
    host.appendChild(opener); document.body.appendChild(host); opener.focus();
    const mount = document.createElement('div'); host.appendChild(mount);
    const root = createRoot(mount);
    const onClose = vi.fn();
    await act(async () => { root.render(<Modal title="Edit" onClose={onClose}><input data-testid="f" /></Modal>); });
    const dlg = document.querySelector('[role="dialog"]')!;
    expect(dlg).toBeTruthy();
    expect(host.contains(dlg)).toBe(false);
    expect(document.querySelector('[data-testid="dialog-form-scroll"]')!.className).toContain('overflow-y-auto');
    expect(dlg.contains(document.activeElement)).toBe(true);
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalled();
    await act(async () => { root.unmount(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // Radix dispatches close-autofocus on the next timer turn, after removal.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(document.activeElement).toBe(opener);
  });
});
