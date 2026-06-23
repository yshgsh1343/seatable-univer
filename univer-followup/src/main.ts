import './styles.css';

const statusEl = document.getElementById('status');
const appEl = document.getElementById('app');

async function boot() {
  if (statusEl) statusEl.textContent = '正在载入 SeaTable 表格';
  if (appEl) appEl.innerHTML = '<div class="sheet-loading">正在载入 SeaTable 表格...</div>';
  await import('./sheet');
}

boot().catch((error) => {
  if (statusEl) statusEl.textContent = '加载失败';
  if (appEl) {
    const message = error instanceof Error ? error.message : String(error);
    appEl.textContent = message;
    appEl.className = 'sheet-loading';
  }
});
