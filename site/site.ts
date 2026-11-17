const status = document.querySelector<HTMLElement>('#copy-status');
for (const button of document.querySelectorAll<HTMLButtonElement>('.copy')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy ?? '');
      const previous = button.textContent; button.textContent = '✓'; button.classList.add('copied');
      if (status) status.textContent = 'Command copied to clipboard.';
      window.setTimeout(() => { button.textContent = previous; button.classList.remove('copied'); }, 1800);
    } catch {
      if (status) status.textContent = 'Copy unavailable. Select and copy the command manually.';
      const code = button.closest('.command-line, .quick-command')?.querySelector('code');
      if (code) { const range = document.createRange(); range.selectNodeContents(code); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
    }
  });
}
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-agent]')];
function selectAgent(tab: HTMLButtonElement): void {
  for (const item of tabs) { item.setAttribute('aria-selected', String(item === tab)); item.tabIndex = item === tab ? 0 : -1; }
  const command = `npx @masstensor/diagnose@latest agent ${tab.dataset.agent}`;
  const code = document.querySelector('#agent-command'), copy = document.querySelector<HTMLButtonElement>('#agent-copy');
  if (code) code.textContent = command;
  if (copy) copy.dataset.copy = command;
  document.querySelector('#agent-panel')?.setAttribute('aria-labelledby', tab.id);
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectAgent(tab));
  tab.addEventListener('keydown', event => {
    const index = tabs.indexOf(tab); let target: HTMLButtonElement | undefined;
    if (event.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length];
    if (event.key === 'ArrowLeft') target = tabs[(index + tabs.length - 1) % tabs.length];
    if (event.key === 'Home') target = tabs[0];
    if (event.key === 'End') target = tabs[tabs.length - 1];
    if (target) { event.preventDefault(); selectAgent(target); target.focus(); }
  });
}
export {};
