// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Modal } from './shared';
let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
describe('opt-in viewport positioning for fee structure and timetable dialogs',()=>{
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
    expect(document.body.style.overflow).toBe('hidden');
    await act(async()=>root.render(null));expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow='';
  });
  it('leaves unrelated legacy callers inline and their scrolling unchanged',async()=>{
    await act(async()=>root.render(<Modal title="Legacy" onClose={vi.fn()}>Unchanged</Modal>));
    expect(host.textContent).toContain('Unchanged');expect(document.body.style.overflow).toBe('');
  });
});