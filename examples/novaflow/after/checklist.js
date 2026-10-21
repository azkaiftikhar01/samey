// Marks a runbook step done or not done. The demo has no backend, so state lives in the page.
for (const button of document.querySelectorAll('.toggle')) {
  button.addEventListener('click', () => {
    const done = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(done));
    button.textContent = done ? 'Done' : 'Mark done';
    button.closest('li').classList.toggle('done', done);
  });
}
