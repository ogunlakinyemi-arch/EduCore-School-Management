// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Modal } from './shared';
let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
describe('shared opt-in viewport form presentation',()=>{
  it('renders outside a transformed page ancestor instead of clipping its selectors',async()=>{
    await act(async()=>root.render(<div style={{transform:'translateY(0)'}}><Modal viewport title="Create" onClose={vi.fn()}><select aria-label="Session"><option>2026/2027</option></select></Modal></div>));
    expect(host.querySelector('[role=dialog]')).toBeNull();
    const dialog=document.body.querySelector('[role=dialog]')!;
    expect(dialog.parentElement).toBe(document.body);expect(dialog.querySelector('select')).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
  it('locks background scrolling and restores it on close',async()=>{
    document.body.style.overflow='auto';
    await act(async()=>root.render(<Modal viewport title="Create" onClose={vi.fn()}>Form</Modal>));
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(true);
    await act(async()=>root.render(null));expect(document.body.style.overflow).toBe('auto');
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
    document.body.style.overflow='';
  });
  it('leaves unrelated legacy callers inline and their scrolling unchanged',async()=>{
    await act(async()=>root.render(<Modal title="Legacy" onClose={vi.fn()}>Unchanged</Modal>));
    expect(host.textContent).toContain('Unchanged');expect(document.body.style.overflow).toBe('');
  });
  it('keeps the heading and close button outside the internally scrolling form',async()=>{
    await act(async()=>root.render(<Modal viewport title="Edit school" onClose={vi.fn()}><form><input aria-label="School name"/><button>Save</button></form></Modal>));
    const dialog=document.querySelector('[role=dialog]')!;
    const scroll=dialog.querySelector('[data-testid=dialog-form-scroll]')!;
    expect(scroll.className).toContain('overflow-y-auto');
    expect(scroll.contains(dialog.querySelector('[data-testid=button-close-dialog]'))).toBe(false);
    expect(document.activeElement).toBe(dialog.querySelector('h2'));
    expect(dialog.querySelector('[data-testid=button-close-dialog]')?.getAttribute('type')).toBe('button');
  });
  it('uses the visible keyboard-sized viewport and cleans up listeners',async()=>{
    const view=Object.assign(new EventTarget(),{width:360,height:640,offsetTop:0,offsetLeft:0});
    const remove=vi.spyOn(view,'removeEventListener');
    vi.stubGlobal('visualViewport',view);
    try {
      await act(async()=>root.render(<Modal viewport title="Add student" onClose={vi.fn()}><input/></Modal>));
      view.height=280;view.offsetTop=100;
      await act(async()=>view.dispatchEvent(new Event('resize')));
      const panel=document.querySelector('[role=dialog]') as HTMLElement;
      expect(panel.style.top).toBe('240px');
      expect(panel.style.width).toBe('328px');
      expect(panel.style.maxHeight).toContain('280px');
      await act(async()=>root.render(null));
      expect(remove).toHaveBeenCalledWith('resize',expect.any(Function));
      expect(remove).toHaveBeenCalledWith('scroll',expect.any(Function));
    } finally {vi.unstubAllGlobals();}
  });
  it('closes on Escape and restores focus without scrolling to a different list row',async()=>{
    const opener=document.createElement('button');document.body.append(opener);opener.focus();
    const focus=vi.spyOn(opener,'focus');
    const close=vi.fn();
    await act(async()=>root.render(<Modal viewport title="Edit subject" onClose={close}><input/></Modal>));
    await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(close).toHaveBeenCalledTimes(1);
    await act(async()=>root.render(null));
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(focus).toHaveBeenCalledWith({preventScroll:true});
    opener.remove();
  });
  it('does not close on an accidental backdrop pointer press',async()=>{
    const close=vi.fn();
    await act(async()=>root.render(<Modal viewport title="Edit" onClose={close}><input/></Modal>));
    await act(async()=>document.body.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true})));
    expect(close).not.toHaveBeenCalled();
  });
  it('keeps forward and backward Tab navigation inside the dialog',async()=>{
    await act(async()=>root.render(<Modal viewport title="Add student" onClose={vi.fn()}><input aria-label="Name"/><button data-testid="last-control">Cancel</button></Modal>));
    const first=document.querySelector('[data-testid=button-close-dialog]') as HTMLButtonElement;
    const last=document.querySelector('[data-testid=last-control]') as HTMLButtonElement;
    await act(async()=>last.focus());
    await act(async()=>last.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));
    expect(document.activeElement).toBe(first);
    await act(async()=>first.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));
    expect(document.activeElement).toBe(last);
  });
  it('keeps the background locked until the final nested dialog closes',async()=>{
    await act(async()=>root.render(<><Modal viewport title="First" onClose={vi.fn()}>One</Modal><Modal viewport title="Second" onClose={vi.fn()}>Two</Modal></>));
    expect(document.body.getAttribute('data-scroll-locked')).toBe('2');
    await act(async()=>root.render(<Modal viewport title="First" onClose={vi.fn()}>One</Modal>));
    expect(document.body.getAttribute('data-scroll-locked')).toBe('1');
    await act(async()=>root.render(null));
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
  });
});