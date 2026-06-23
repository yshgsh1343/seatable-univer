import './styles.css';

const statusEl = document.getElementById('status');
const appEl = document.getElementById('app');

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderLoading(message: string) {
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="sheet-loading">
      <div class="loading-line">
        <div class="loading-bar"></div>
      </div>
      <div class="loading-title">${message}</div>
      <div class="loading-subtitle">如果网络或数据接口暂时不可用，这里会显示错误信息。</div>
    </div>
  `;
}

async function boot() {
  if (statusEl) statusEl.textContent = '正在载入 SeaTable 表格';
  renderLoading('正在载入 SeaTable 表格');
  await import('./sheet');
}

boot().catch((error) => {
  if (statusEl) statusEl.textContent = '加载失败';
  if (appEl) {
    const message = error instanceof Error ? error.message : String(error);
    appEl.innerHTML = `
      <div class="sheet-loading load-failed">
        <div class="loading-line stopped">
          <div class="loading-bar"></div>
        </div>
        <div class="loading-title">加载失败</div>
        <div class="loading-subtitle">${escapeHtml(message)}</div>
      </div>
    `;
  }
});
