const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch();
  const rows = [];
  for (const mode of ['naive', 'batched']) {
    for (let run = 1; run <= 3; run++) {
      const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
      const url = 'file://' + path.resolve(__dirname, 'index.html') + `?mode=${mode}&perFrame=200&intervalMs=10&durationMs=5000`;
      const t0 = Date.now();
      await p.goto(url);
      await p.waitForTimeout(6500);
      const m = await p.evaluate(() => { const lt = window.__longTasks; return { commits: window.__commits, frames: window.__frames, longTasks: lt.length, longTaskMs: Math.round(lt.reduce((a, b) => a + b, 0)), maxLongTask: Math.round(Math.max(0, ...lt)), domRows: document.querySelectorAll('#root div[style*="height: 32"], #root div[style*="translateY"]').length, newest: (document.querySelector('#root div[style*="height: 32"], #root div[style*="translateY"]')||{}).textContent }; });
      const elapsed = (Date.now() - t0) / 1000;
      rows.push({ mode, run, ...m, fps: Math.round(m.frames / elapsed) });
      await p.close();
    }
  }
  await b.close();
  console.table(rows);
})();
