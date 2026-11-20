// ══════════════════════════════════════════════════════
//  PT MAKMUR — GROWTOPIA FINANCE TRACKER
//  app.js — Core Application Logic
// ══════════════════════════════════════════════════════

(function() {
  'use strict';

  // ── CONSTANTS ──────────────────────────────────────
  const PROXY_PRICE_PER_SESSION = 60000; // Rp
  const PROXY_HOURS_PER_SESSION = 3;
  const DEFAULT_MODAL_PER_FOUNDER = 5;   // BGL
  const FOUNDERS = ['SURCAK', 'VISUNA', 'AVON'];

  const CURRENCY_IMG = {
    BGL: 'icons/bgl.png',
    DL:  'icons/dl.png',
    WL:  'icons/wl.png',
  };

  function icon(c, customClass = 'gt-currency-img-inline') {
    const src = CURRENCY_IMG[c];
    if (src) {
      return `<img src="${src}" class="${customClass}" alt="${c}">`;
    }
    return '';
  }

  // ── STATE ───────────────────────────────────────────
  // Cloud sync vars — declared here so saveState can reference them
  let _pauseRemoteWrite = false;

  let state = loadState();

  function defaultState() {
    return {
      currentSession: {
        date: todayStr(),
        modals: [],       // { founder, amount, currency, note, time }
        transactions: [], // { type, amount, currency, category, note, time }
        proxy: [],        // { hours, cost, note, proof, time }
      },
      rate: { BGL: 100000, DL: 1000, WL: 10, take: 100000, setor: 99000 },
      history: [],  // array of session snapshots
      proxyIconUrl: null,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem('ptmakmur_v2');
      if (raw) {
        const s = JSON.parse(raw);
        if (!s.rate || typeof s.rate.BGL !== 'number' || s.rate.BGL < 1000) {
          s.rate = { BGL: 100000, DL: 1000, WL: 10, take: 100000, setor: 99000 };
        }
        if (!s.rate.take) s.rate.take = 100000;
        if (!s.rate.setor) s.rate.setor = 99000;
        return s;
      }
    } catch(e) {}
    return defaultState();
  }

  function saveState() {
    try { localStorage.setItem('ptmakmur_v2', JSON.stringify(state)); }
    catch(e) {}
    // Push to MongoDB Atlas serverless API if not paused
    if (typeof _pauseRemoteWrite !== 'undefined' && !_pauseRemoteWrite) {
      if (typeof pushMongoState === 'function') {
        pushMongoState(state);
      }
    }
  }

  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  // ── CURRENCY HELPERS ────────────────────────────────
  function toBGL(amount, currency) {
    // In Growtopia: 1 BGL = 100 DL = 10.000 WL
    if (currency === 'BGL') return amount;
    if (currency === 'DL')  return amount / 100;
    if (currency === 'WL')  return amount / 10000;
    return amount;
  }

  function formatCurrency(amount, currency) {
    const icn = icon(currency);
    const formatted = (amount === Math.floor(amount)) ? amount.toLocaleString('id-ID') : parseFloat(amount.toFixed(4));
    return `${icn} ${formatted} ${currency}`;
  }

  function toIDR(bglAmount) {
    const rate = state.rate?.BGL || 100000;
    return Math.round(bglAmount * rate);
  }

  function formatIDR(val) {
    return 'Rp ' + Math.round(val).toLocaleString('id-ID');
  }

  function bglToDisplay(bgl) {
    if (Math.abs(bgl) >= 1) return `${icon('BGL')} ${bgl.toFixed(4)} BGL`;
    const dl = bgl * 100;
    if (Math.abs(dl) >= 1) return `${icon('DL')} ${dl.toFixed(2)} DL`;
    const wl = bgl * 10000;
    return `${icon('WL')} ${Math.round(wl)} WL`;
  }

  // Compute totals for current session
  function computeTotals() {
    const sess = state.currentSession;
    let totalModalBGL = 0;
    sess.modals.forEach(m => { totalModalBGL += toBGL(m.amount, m.currency); });

    let totalIncomeBGL = 0;
    let totalExpenseBGL = 0;
    sess.transactions.forEach(t => {
      const v = toBGL(t.amount, t.currency);
      if (t.type === 'income')  totalIncomeBGL  += v;
      else                       totalExpenseBGL += v;
    });

    let totalProxyCost = 0;
    let totalProxySessions = 0;
    let totalProxyHours = 0;
    (sess.proxy || []).forEach(p => {
      totalProxyCost += (p.cost || 0);
      totalProxySessions += 1;
      totalProxyHours += (p.hours || 3);
    });

    const netBGL   = totalIncomeBGL - totalExpenseBGL;
    const profitBGL = netBGL; // After modal subtracted during split
    const totalBackpackBGL = totalModalBGL + totalIncomeBGL - totalExpenseBGL;

    return { totalModalBGL, totalIncomeBGL, totalExpenseBGL, totalProxyCost, totalProxySessions, totalProxyHours, netBGL, profitBGL, totalBackpackBGL };
  }

  // ── NAVIGATION ─────────────────────────────────────
  const pageTitles = {
    dashboard: 'Dashboard',
    modal:     'Catat Modal',
    transaksi: 'Pemasukan & Pengeluaran',
    proxy:     'Biaya Proxy',
    rate:      'Rate BGL',
    history:   'Riwayat Harian',
  };

  function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const target = document.getElementById('page-' + page);
    if (target) target.classList.add('active');

    const navItem = document.querySelector(`[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');

    const titleEl = document.getElementById('topbarTitle');
    if (titleEl) titleEl.textContent = pageTitles[page] || page;

    // Refresh page content
    if (page === 'dashboard') renderDashboard();
    if (page === 'modal')     renderModalPage();
    if (page === 'transaksi') renderTransaksiPage();
    if (page === 'proxy')     renderProxyPage();
    if (page === 'rate')      renderRatePage();
    if (page === 'history')   renderHistoryPage();

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('mobile-open');
  }

  // ── TOAST ───────────────────────────────────────────
  let toastTimer;
  function showToast(msg, type = 'success') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3000);
  }

  // ── CONFIRM MODAL ───────────────────────────────────
  let confirmCallback = null;
  function showConfirm(title, msg, cb) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMsg').textContent = msg;
    document.getElementById('modalOverlay').classList.add('show');
    confirmCallback = cb;
  }

  // ── DATE ────────────────────────────────────────────
  function updateDateDisplay() {
    const el = document.getElementById('currentDate');
    if (!el) return;
    const d = new Date();
    el.textContent = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ── DASHBOARD ───────────────────────────────────────
  function renderDashboard() {
    const t = computeTotals();

    // Cards
    setInner('dash-modal', `${icon('BGL')} ${t.totalBackpackBGL.toFixed(4)} BGL`);
    setInner('dash-modal-idr', `≈ ${formatIDR(toIDR(t.totalBackpackBGL))}`);
    setInner('dash-modal-info', `Modal: ${t.totalModalBGL.toFixed(2)} BGL`);
    setInner('dash-modal-trend', `${state.currentSession.modals.length} setoran`);

    setInner('dash-income', `${icon('BGL')} ${t.totalIncomeBGL.toFixed(4)} BGL`);
    setInner('dash-income-idr', `≈ ${formatIDR(toIDR(t.totalIncomeBGL))}`);

    setInner('dash-expense', `${icon('BGL')} ${t.totalExpenseBGL.toFixed(4)} BGL`);
    setInner('dash-expense-idr', `≈ ${formatIDR(toIDR(t.totalExpenseBGL))}`);

    const rateSetor = state.rate?.setor || 99000;
    const proxyBGL = rateSetor > 0 ? (t.totalProxyCost / rateSetor) : 0;
    const proxyDL  = proxyBGL * 100;
    setInner('dash-proxy', formatIDR(t.totalProxyCost));
    setInner('dash-proxy-sessions', `${t.totalProxySessions} sesi (${t.totalProxyHours || 0} jam)`);
    setInner('dash-proxy-bgl', rateSetor > 0 ? `≈ ${proxyDL.toFixed(1)} DL / ${proxyBGL.toFixed(4)} BGL` : '');

    // Profit
    const profitEl = document.getElementById('profitValue');
    const profitCard = document.getElementById('profitCard');
    const net = t.netBGL;
    const shareEach = net / 3;

    profitEl.textContent = `${net >= 0 ? '+' : ''}${net.toFixed(4)} BGL`;
    profitEl.className = `profit-value ${net > 0 ? 'positive' : net < 0 ? 'negative' : ''}`;
    setInner('profitIdr', `≈ ${formatIDR(toIDR(Math.abs(net)))} (${net >= 0 ? 'PROFIT' : 'RUGI'})`);

    if (net > 0) profitCard.style.borderColor = 'rgba(16,185,129,0.3)';
    else if (net < 0) profitCard.style.borderColor = 'rgba(239,68,68,0.3)';
    else profitCard.style.borderColor = '';

    const shareSign = shareEach >= 0 ? '+' : '';
    ['surcak','visuna','avon'].forEach(f => {
      setInner(`share-${f}`, `${shareSign}${shareEach.toFixed(4)} BGL`);
    });

    // Recent transactions (last 5)
    const all = [...state.currentSession.transactions].reverse().slice(0, 5);
    renderTxList('dash-tx-list', all, true);
  }

  function setInner(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  // ── MODAL PAGE ──────────────────────────────────────
  function renderModalPage() {
    const perFounder = { SURCAK: 0, VISUNA: 0, AVON: 0 };
    state.currentSession.modals.forEach(m => {
      perFounder[m.founder] = (perFounder[m.founder] || 0) + toBGL(m.amount, m.currency);
    });

    FOUNDERS.forEach(f => {
      const id = f.toLowerCase();
      const v = perFounder[f] || 0;
      setInner(`recap-${id}`, `${icon('BGL')} ${v.toFixed(2)} BGL`);
      setInner(`status-${id}`, v >= DEFAULT_MODAL_PER_FOUNDER ? '✅' : v > 0 ? '⚠️' : '⏳');
    });

    const total = Object.values(perFounder).reduce((a,b) => a+b, 0);
    setInner('modal-total-val', `${icon('BGL')} ${total.toFixed(2)} BGL`);

    // Log list
    renderTxList('modal-log-list', [...state.currentSession.modals].reverse(), false, 'modal');
  }

  // ── TRANSAKSI PAGE ──────────────────────────────────
  let currentTxType = 'income';
  let txFilter = 'all';

  function renderTransaksiPage() {
    const t = computeTotals();
    setInner('sum-income', `${icon('BGL')} ${t.totalIncomeBGL.toFixed(4)} BGL`);
    setInner('sum-expense', `${icon('BGL')} ${t.totalExpenseBGL.toFixed(4)} BGL`);

    const net = t.totalIncomeBGL - t.totalExpenseBGL;
    const netEl = document.getElementById('sum-net');
    if (netEl) {
      netEl.textContent = `${net >= 0 ? '+' : ''}${net.toFixed(4)} BGL`;
      netEl.className = `summary-value ${net > 0 ? 'green' : net < 0 ? 'red' : ''}`;
    }

    setInner('conv-bgl-dl', '100 DL');
    setInner('conv-dl-wl', '100 WL');

    // Filtered list
    let txs = [...state.currentSession.transactions].reverse();
    if (txFilter !== 'all') txs = txs.filter(t => t.type === txFilter);
    renderTxList('tx-list', txs, true, null);
  }

  // ── PROXY PRICING HELPER ────────────────────────────
  // Fixed price: 3 jam = 60k (minimum). Menambah 1 jam = +20k.
  function getProxyCost(hours) {
    const h = Math.max(3, parseInt(hours) || 3);
    return h * 20000;
  }

  // ── PROXY PAGE ──────────────────────────────────────
  let selectedProofBase64 = null;
  let selectedProofName = '';

  function renderProxyPage() {
    const t = computeTotals();
    const rateSetor = state.rate?.setor || 99000;
    const totalProxyBGL = rateSetor > 0 ? (t.totalProxyCost / rateSetor) : 0;
    const totalProxyDL  = totalProxyBGL * 100;

    setInner('ps-sessions', `${t.totalProxySessions} Sesi`);
    setInner('ps-duration', `${t.totalProxyHours} Jam`);
    setInner('ps-cost', formatIDR(t.totalProxyCost));
    setInner('ps-cost-bgl', rateSetor > 0 ? `≈ ${totalProxyDL.toFixed(2)} DL / ${totalProxyBGL.toFixed(4)} BGL` : '');

    renderTxList('proxy-log-list', [...state.currentSession.proxy].reverse(), true, 'proxy');

    // Update proxy icon
    const wrap = document.getElementById('proxyIconDisplay');
    if (wrap) {
      wrap.innerHTML = `<img src="icons/immortal_proxy.png" class="proxy-banner-img" alt="Immortal Proxy">`;
    }
  }

  function updateProxyCalc() {
    const hoursInput = document.getElementById('proxy-hours');
    let hours = parseInt(hoursInput?.value || 3);
    if (isNaN(hours) || hours < 3) hours = 3;
    const cost = getProxyCost(hours);

    setInner('proxy-calc-hours', `${hours} Jam`);
    setInner('proxy-calc-price', formatIDR(cost));

    // Live DL/BGL converter
    const rateSetor = state.rate?.setor || 99000;
    if (rateSetor > 0) {
      const bgl = cost / rateSetor;
      const dl  = bgl * 100;
      setInner('proxy-conv-bgl', `≈ ${bgl.toFixed(4)} BGL`);
      setInner('proxy-conv-dl',  `≈ ${dl.toFixed(2)} DL`);
    } else {
      setInner('proxy-conv-bgl', '—');
      setInner('proxy-conv-dl', '—');
    }

    // Highlight active preset button
    document.querySelectorAll('.btn-preset-proxy').forEach(btn => {
      const bh = parseInt(btn.dataset.hours);
      if (bh === hours) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }

  // ── RATE PAGE ───────────────────────────────────────
  function renderRatePage() {
    const bglIdr = state.rate?.BGL || 100000;
    const dlIdr = Math.round(bglIdr / 100);
    const wlIdr = parseFloat((bglIdr / 10000).toFixed(2));

    const rateBglEl = document.getElementById('rate-bgl');
    const rateDlEl  = document.getElementById('rate-dl');
    const rateWlEl  = document.getElementById('rate-wl');
    if (rateBglEl) rateBglEl.value = bglIdr;
    if (rateDlEl)  rateDlEl.value  = dlIdr;
    if (rateWlEl)  rateWlEl.value  = wlIdr;

    const takeEl = document.getElementById('rate-take');
    const setorEl = document.getElementById('rate-setor');
    if (takeEl)  takeEl.value  = state.rate?.take || '';
    if (setorEl) setorEl.value = state.rate?.setor || '';

    updateConversionCalc();
    updateSpread();
  }

  function updateConversionCalc() {
    const amount = parseFloat(document.getElementById('conv-amount')?.value || 1);
    const from   = document.getElementById('conv-from')?.value || 'BGL';

    const bgl = toBGL(amount, from);
    const dl  = bgl * 100;
    const wl  = bgl * 10000;
    const idr = toIDR(bgl);

    setInner('conv-to-bgl', `${bgl.toFixed(4)} BGL`);
    setInner('conv-to-dl',  `${dl.toFixed(2)} DL`);
    setInner('conv-to-wl',  `${wl.toLocaleString('id-ID')} WL`);
    setInner('conv-to-idr', formatIDR(idr));
  }

  function updateSpread() {
    const takeInput  = document.getElementById('rate-take');
    const setorInput = document.getElementById('rate-setor');
    const takeVal  = parseFloat(takeInput?.value || 0);
    const setorVal = parseFloat(setorInput?.value || 0);

    // Auto-sync to state
    if (state.rate) {
      state.rate.take = takeVal;
      state.rate.setor = setorVal;
      saveState();
    }

    const spreadEl = document.getElementById('rate-spread-val');
    if (!spreadEl) return;

    if (!takeVal || !setorVal) {
      spreadEl.innerHTML = 'Spread: <span style="color:var(--text-muted);">-</span>';
      spreadEl.className = 'calc-display';
      spreadEl.style.borderColor = 'var(--border)';
      spreadEl.style.background = 'rgba(255,255,255,0.03)';
      return;
    }

    // Rate Take = Harga Beli PT ke Reseller (e.g. 100k)
    // Rate Setor = Harga Jual PT ke Reseller (e.g. 99k)
    // Spread = Setor - Take (kerugian dialami jika Setor < Take)
    const spread = setorVal - takeVal;
    const pct = takeVal > 0 ? ((spread / takeVal) * 100).toFixed(2) : '0';

    if (spread < 0) {
      const absSpread = Math.abs(spread);
      spreadEl.innerHTML = `Spread: <strong style="color:var(--red-light);font-size:14px;">-${formatIDR(absSpread)}</strong> / BGL <span style="font-size:11px;color:var(--red-light);margin-left:4px;">(${pct}%) · ⚠️ RUGI</span>`;
      spreadEl.className = 'calc-display';
      spreadEl.style.borderColor = 'rgba(239,68,68,0.4)';
      spreadEl.style.background = 'rgba(239,68,68,0.08)';
    } else if (spread > 0) {
      spreadEl.innerHTML = `Spread: <strong style="color:var(--green-light);font-size:14px;">+${formatIDR(spread)}</strong> / BGL <span style="font-size:11px;color:var(--green-light);margin-left:4px;">(+${pct}%) · ✅ PROFIT</span>`;
      spreadEl.className = 'calc-display';
      spreadEl.style.borderColor = 'rgba(34,197,94,0.4)';
      spreadEl.style.background = 'rgba(34,197,94,0.08)';
    } else {
      spreadEl.innerHTML = `Spread: <strong style="color:var(--text-primary);font-size:14px;">Rp 0</strong> / BGL <span style="font-size:11px;color:var(--text-muted);margin-left:4px;">(0.00%) · ⚖️ IMPAS</span>`;
      spreadEl.className = 'calc-display';
      spreadEl.style.borderColor = 'var(--border)';
      spreadEl.style.background = 'rgba(255,255,255,0.03)';
    }
  }

  // ── HISTORY PAGE ────────────────────────────────────
  function renderHistoryPage() {
    const list = document.getElementById('history-list');
    if (!list) return;

    const monthFilter = document.getElementById('history-month')?.value;

    let sessions = [...state.history].reverse();
    if (monthFilter) {
      sessions = sessions.filter(s => s.date && s.date.startsWith(monthFilter));
    }

    if (sessions.length === 0) {
      list.innerHTML = '<div class="tx-empty">Belum ada riwayat sesi</div>';
      return;
    }

    list.innerHTML = '';
    sessions.forEach((sess, idx) => {
      const t = calcSessionTotals(sess);
      const net = t.totalIncomeBGL - t.totalExpenseBGL;
      const dateStr = sess.date ? formatDate(sess.date) : 'Tanpa Tanggal';
      const badgeClass = net > 0 ? 'profit' : net < 0 ? 'loss' : 'neutral';
      const badgeLabel = net > 0 ? `+${net.toFixed(2)} BGL` : net < 0 ? `${net.toFixed(2)} BGL` : '0 BGL';

      const card = document.createElement('div');
      card.className = 'history-day-card';
      card.innerHTML = `
        <div class="history-day-header" data-idx="${idx}">
          <div class="history-day-title">📅 ${dateStr}</div>
          <div class="history-day-badges">
            <span class="badge ${badgeClass}">${net >= 0 ? '📈' : '📉'} ${badgeLabel}</span>
            <span class="badge neutral">${icon('BGL')} Modal: ${t.totalModalBGL.toFixed(2)} BGL</span>
            <span class="badge neutral"><img src="icons/immortal_proxy_32.png" class="proxy-img-inline" alt="Proxy"> Proxy: ${formatIDR(t.totalProxyCost)}</span>
          </div>
        </div>
        <div class="history-day-body" id="hbody-${idx}">
          <div class="history-mini-grid">
            <div class="history-mini-item">
              <div class="history-mini-label">Modal</div>
              <div class="history-mini-val">${icon('BGL')} ${t.totalModalBGL.toFixed(2)} BGL</div>
            </div>
            <div class="history-mini-item">
              <div class="history-mini-label">Pemasukan</div>
              <div class="history-mini-val" style="color:var(--green-light)">${icon('BGL')} ${t.totalIncomeBGL.toFixed(4)} BGL</div>
            </div>
            <div class="history-mini-item">
              <div class="history-mini-label">Pengeluaran</div>
              <div class="history-mini-val" style="color:var(--red-light)">${icon('BGL')} ${t.totalExpenseBGL.toFixed(4)} BGL</div>
            </div>
            <div class="history-mini-item">
              <div class="history-mini-label">Proxy</div>
              <div class="history-mini-val" style="color:var(--orange)">${formatIDR(t.totalProxyCost)}</div>
            </div>
          </div>
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">BAGI HASIL PER PENDIRI</div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;">
              ${FOUNDERS.map((f,i) => `
                <div style="display:flex;align-items:center;gap:8px;">
                  <div class="founder-avatar ${f.toLowerCase()} sm">${f[0]}</div>
                  <div>
                    <div style="font-size:10px;color:var(--text-muted)">${f}</div>
                    <div style="font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:700;color:${net >= 0 ? 'var(--green-light)' : 'var(--red-light)'}">${net >= 0 ? '+' : ''}${(net/3).toFixed(4)} BGL</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          <div style="margin-top:12px;text-align:right;">
            <button class="btn-danger" style="display:inline-flex;padding:7px 14px;font-size:12px;" data-delete-session="${idx}">🗑 Hapus Sesi</button>
          </div>
        </div>
      `;
      list.appendChild(card);

      // Toggle body
      card.querySelector('.history-day-header').addEventListener('click', () => {
        const body = document.getElementById(`hbody-${idx}`);
        body.classList.toggle('open');
      });

      // Delete session
      const delBtn = card.querySelector('[data-delete-session]');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showConfirm('Hapus Sesi', 'Data sesi ini akan dihapus permanen.', () => {
          const realIdx = state.history.length - 1 - idx;
          state.history.splice(realIdx, 1);
          saveState();
          renderHistoryPage();
          showToast('Sesi dihapus', 'info');
        });
      });
    });
  }

  function calcSessionTotals(sess) {
    let totalModalBGL = 0, totalIncomeBGL = 0, totalExpenseBGL = 0, totalProxyCost = 0;
    (sess.modals || []).forEach(m => { totalModalBGL += toBGL(m.amount, m.currency); });
    (sess.transactions || []).forEach(t => {
      const v = toBGL(t.amount, t.currency);
      if (t.type === 'income') totalIncomeBGL += v;
      else totalExpenseBGL += v;
    });
    (sess.proxy || []).forEach(p => { totalProxyCost += (p.cost || 0); });
    return { totalModalBGL, totalIncomeBGL, totalExpenseBGL, totalProxyCost };
  }

  function formatDate(str) {
    const d = new Date(str + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ── GENERIC TX LIST RENDERER ────────────────────────
  function renderTxList(containerId, items, showDelete, overrideType) {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!items || items.length === 0) {
      el.innerHTML = '<div class="tx-empty">Belum ada data</div>';
      return;
    }

    el.innerHTML = '';
    items.forEach((item, idx) => {
      const type = overrideType || item.type || 'income';
      const timeStr = item.time || '';

      let typeIconHtml = '📋';
      if (type === 'proxy') {
        typeIconHtml = '<img src="icons/immortal_proxy_32.png" class="proxy-img-sm" alt="Proxy">';
      } else if (type === 'modal') {
        typeIconHtml = icon(item.currency || 'BGL', 'gt-currency-img-sm');
      } else if (item.currency) {
        typeIconHtml = icon(item.currency, 'gt-currency-img-sm');
      } else {
        typeIconHtml = item.type === 'income' ? '📈' : '📉';
      }

      const div = document.createElement('div');
      div.className = 'tx-item';

      let amountHtml = '';
      let amountClass = '';
      if (type === 'proxy') {
        const rateSetor = state.rate?.setor || 99000;
        const itemBGL = rateSetor > 0 ? (item.cost / rateSetor) : 0;
        const itemDL  = itemBGL * 100;
        const dlStr   = rateSetor > 0 ? `<span style="font-size:10px;color:var(--orange);display:block;">≈ ${itemDL.toFixed(2)} DL / ${itemBGL.toFixed(4)} BGL</span>` : '';
        amountHtml = `<span class="tx-amount proxy">${formatIDR(item.cost)}${dlStr}</span>`;
      } else if (type === 'modal') {
        amountHtml = `<span class="tx-amount modal">+${formatCurrency(item.amount, item.currency)}</span>`;
      } else {
        amountClass = item.type === 'income' ? 'income' : 'expense';
        const sign = item.type === 'income' ? '+' : '-';
        amountHtml = `<span class="tx-amount ${amountClass}">${sign}${formatCurrency(item.amount, item.currency)}</span>`;
      }

      const metaParts = [];
      if (item.category) metaParts.push(item.category);
      if (timeStr) metaParts.push(timeStr);
      if (type === 'proxy') {
        const h = item.hours || 3;
        metaParts.push(`${h} Jam sewa`);
      }
      if (type === 'modal') metaParts.push(`Modal ${item.founder}`);

      let proofBtnHtml = '';
      if (type === 'proxy' && item.proof) {
        proofBtnHtml = `<button type="button" class="btn-view-proof" data-proof-id="${item.id}" title="Lihat Bukti Transfer">🧾 Lihat Bukti</button>`;
      }

      div.innerHTML = `
        <div class="tx-type-icon ${type}">${typeIconHtml}</div>
        <div class="tx-info">
          <div class="tx-title" style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
            <span>${item.note || (type === 'modal' ? `Setoran ${item.founder}` : type === 'proxy' ? 'Sesi Proxy' : 'Transaksi')}</span>
            ${proofBtnHtml}
          </div>
          <div class="tx-meta">${metaParts.join(' · ')}</div>
        </div>
        ${amountHtml}
        ${showDelete ? `<button class="tx-delete" data-id="${item.id}" data-type="${type}" title="Hapus">✕</button>` : ''}
      `;

      // Wire up view proof button
      if (type === 'proxy' && item.proof) {
        div.querySelector('.btn-view-proof')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const modalOverlay = document.getElementById('proofModalOverlay');
          const modalImg = document.getElementById('proofModalImg');
          const modalCaption = document.getElementById('proofModalCaption');
          if (modalOverlay && modalImg) {
            modalImg.src = item.proof;
            if (modalCaption) {
              const h = item.hours || 3;
              modalCaption.textContent = `Sesi Proxy: ${h} Jam · ${formatIDR(item.cost)} · ${item.time || ''} ${item.note ? `· ${item.note}` : ''}`;
            }
            modalOverlay.classList.add('show');
          }
        });
      }

      if (showDelete) {
        div.querySelector('.tx-delete')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const itemId = e.target.dataset.id;
          const itemType = e.target.dataset.type;
          showConfirm('Hapus Data', 'Hapus item ini dari pencatatan?', () => {
            deleteItem(itemId, itemType);
          });
        });
      }

      el.appendChild(div);
    });
  }

  function deleteItem(id, type) {
    if (type === 'modal') {
      state.currentSession.modals = state.currentSession.modals.filter(x => x.id !== id);
    } else if (type === 'proxy') {
      state.currentSession.proxy = state.currentSession.proxy.filter(x => x.id !== id);
    } else {
      state.currentSession.transactions = state.currentSession.transactions.filter(x => x.id !== id);
    }
    saveState();
    refreshCurrentPage();
    showToast('Item dihapus', 'info');
  }

  function refreshCurrentPage() {
    const activePage = document.querySelector('.page.active');
    if (!activePage) return;
    const pageId = activePage.id.replace('page-', '');
    navigateTo(pageId);
  }

  // Render all pages (called after cloud sync state merge)
  function renderAll() {
    renderDashboard();
    refreshCurrentPage();
  }

  // ── UNIQUE ID ───────────────────────────────────────
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function timeNow() {
    return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  // ── EVENT HANDLERS ──────────────────────────────────
  function initEvents() {

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        if (page) navigateTo(page);
      });
    });

    // .btn-link with data-page
    document.querySelectorAll('.btn-link[data-page]').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.page));
    });

    // Mobile sidebar toggle
    document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('mobile-open');
    });
    document.getElementById('sidebarToggle')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });

    // ── ADD MODAL ──
    document.getElementById('btnAddModal')?.addEventListener('click', () => {
      const founder  = document.getElementById('modal-founder')?.value;
      const amount   = parseFloat(document.getElementById('modal-amount')?.value);
      const currency = document.getElementById('modal-currency')?.value;
      const note     = document.getElementById('modal-note')?.value?.trim();

      if (!amount || amount <= 0) { showToast('Masukkan jumlah modal yang valid', 'error'); return; }

      state.currentSession.modals.push({ id: uid(), founder, amount, currency, note, time: timeNow() });
      saveState();
      showToast(`Modal ${founder} (${formatCurrency(amount, currency)}) berhasil dicatat!`, 'success');

      document.getElementById('modal-amount').value = DEFAULT_MODAL_PER_FOUNDER;
      document.getElementById('modal-note').value = '';
      renderModalPage();
    });

    // ── TRANSACTION TYPE TOGGLE ──
    document.getElementById('btn-income')?.addEventListener('click', () => {
      currentTxType = 'income';
      document.getElementById('btn-income').className = 'type-btn active income-active';
      document.getElementById('btn-expense').className = 'type-btn';
    });
    document.getElementById('btn-expense')?.addEventListener('click', () => {
      currentTxType = 'expense';
      document.getElementById('btn-expense').className = 'type-btn active expense-active';
      document.getElementById('btn-income').className = 'type-btn';
    });

    // ── ADD TRANSACTION ──
    document.getElementById('btnAddTx')?.addEventListener('click', () => {
      const amount   = parseFloat(document.getElementById('tx-amount')?.value);
      const currency = document.getElementById('tx-currency')?.value;
      const category = document.getElementById('tx-category')?.value;
      const note     = document.getElementById('tx-note')?.value?.trim();

      if (!amount || amount <= 0) { showToast('Masukkan jumlah transaksi yang valid', 'error'); return; }

      state.currentSession.transactions.push({
        id: uid(), type: currentTxType, amount, currency, category, note, time: timeNow()
      });
      saveState();
      showToast(`${currentTxType === 'income' ? 'Pemasukan' : 'Pengeluaran'} ${formatCurrency(amount, currency)} dicatat!`, 'success');

      document.getElementById('tx-amount').value = '';
      document.getElementById('tx-note').value = '';
      renderTransaksiPage();
    });

    // ── FILTER BUTTONS ──
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        txFilter = btn.dataset.filter;
        renderTransaksiPage();
      });
    });

    // ── PROXY STEPPER & PRESETS ──
    const proxyHoursInput = document.getElementById('proxy-hours');
    document.getElementById('proxyMinus')?.addEventListener('click', () => {
      if (proxyHoursInput) {
        let current = parseInt(proxyHoursInput.value) || 3;
        if (current > 3) {
          proxyHoursInput.value = current - 1;
          updateProxyCalc();
        }
      }
    });
    document.getElementById('proxyPlus')?.addEventListener('click', () => {
      if (proxyHoursInput) {
        let current = parseInt(proxyHoursInput.value) || 3;
        proxyHoursInput.value = current + 1;
        updateProxyCalc();
      }
    });
    proxyHoursInput?.addEventListener('input', () => {
      updateProxyCalc();
    });
    proxyHoursInput?.addEventListener('blur', () => {
      let current = parseInt(proxyHoursInput.value) || 3;
      if (current < 3) proxyHoursInput.value = 3;
      updateProxyCalc();
    });

    // Preset buttons (3 Jam, 4 Jam, 5 Jam, 6 Jam, 12 Jam)
    document.querySelectorAll('.btn-preset-proxy').forEach(btn => {
      btn.addEventListener('click', () => {
        const h = parseInt(btn.dataset.hours);
        if (proxyHoursInput && h >= 3) {
          proxyHoursInput.value = h;
          updateProxyCalc();
        }
      });
    });

    // ── PROXY PROOF UPLOAD & PREVIEW ──
    const proofUploadZone = document.getElementById('proofUploadZone');
    const proxyProofInput = document.getElementById('proxyProofInput');
    const proofPlaceholder = document.getElementById('proofPlaceholder');
    const proofPreviewWrap = document.getElementById('proofPreviewWrap');
    const proofPreviewImg = document.getElementById('proofPreviewImg');
    const proofFileName = document.getElementById('proofFileName');
    const btnRemoveProof = document.getElementById('btnRemoveProof');

    function resetProofInput() {
      selectedProofBase64 = null;
      selectedProofName = '';
      if (proxyProofInput) proxyProofInput.value = '';
      if (proofPreviewImg) proofPreviewImg.src = '';
      if (proofPreviewWrap) proofPreviewWrap.style.display = 'none';
      if (proofPlaceholder) proofPlaceholder.style.display = 'block';
    }

    function handleProofFile(file) {
      if (!file || !file.type.startsWith('image/')) {
        showToast('Pilih file gambar (PNG / JPG / JPEG)', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        selectedProofBase64 = ev.target.result;
        selectedProofName = file.name;
        if (proofPreviewImg) proofPreviewImg.src = selectedProofBase64;
        if (proofFileName) proofFileName.textContent = file.name;
        if (proofPlaceholder) proofPlaceholder.style.display = 'none';
        if (proofPreviewWrap) proofPreviewWrap.style.display = 'flex';
        showToast('Bukti transfer dipilih!', 'success');
      };
      reader.readAsDataURL(file);
    }

    proofUploadZone?.addEventListener('click', (e) => {
      if (e.target.closest('#btnRemoveProof')) return;
      proxyProofInput?.click();
    });
    proofUploadZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      proofUploadZone.classList.add('dragover');
    });
    proofUploadZone?.addEventListener('dragleave', () => {
      proofUploadZone.classList.remove('dragover');
    });
    proofUploadZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      proofUploadZone.classList.remove('dragover');
      const file = e.dataTransfer?.files[0];
      if (file) handleProofFile(file);
    });
    proxyProofInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleProofFile(file);
    });
    btnRemoveProof?.addEventListener('click', (e) => {
      e.stopPropagation();
      resetProofInput();
      showToast('Bukti transfer dihapus', 'info');
    });

    // ── PROOF VIEWER MODAL ──
    const proofModalOverlay = document.getElementById('proofModalOverlay');
    const btnCloseProofModal = document.getElementById('btnCloseProofModal');
    btnCloseProofModal?.addEventListener('click', () => {
      proofModalOverlay?.classList.remove('show');
    });
    proofModalOverlay?.addEventListener('click', (e) => {
      if (e.target === proofModalOverlay) {
        proofModalOverlay.classList.remove('show');
      }
    });

    // ── ADD PROXY ──
    document.getElementById('btnAddProxy')?.addEventListener('click', () => {
      const hours = Math.max(3, parseInt(document.getElementById('proxy-hours')?.value || 3));
      const note  = document.getElementById('proxy-note')?.value?.trim();
      const cost  = getProxyCost(hours);

      state.currentSession.proxy.push({
        id: uid(),
        hours,
        cost,
        note,
        proof: selectedProofBase64 || null,
        time: timeNow()
      });
      saveState();
      showToast(`${hours} Jam proxy (${formatIDR(cost)}) berhasil dicatat!`, 'success');

      // Reset form
      if (proxyHoursInput) proxyHoursInput.value = 3;
      document.getElementById('proxy-note').value = '';
      resetProofInput();
      updateProxyCalc();
      renderProxyPage();
      updateDashboard();
    });

    // ── RATE SETTINGS & SYNC ──
    const rateBglInput = document.getElementById('rate-bgl');
    const rateDlInput  = document.getElementById('rate-dl');
    const rateWlInput  = document.getElementById('rate-wl');

    rateBglInput?.addEventListener('input', () => {
      const val = parseFloat(rateBglInput.value) || 0;
      if (rateDlInput) rateDlInput.value = Math.round(val / 100);
      if (rateWlInput) rateWlInput.value = parseFloat((val / 10000).toFixed(2));
    });

    rateWlInput?.addEventListener('input', () => {
      const val = parseFloat(rateWlInput.value) || 0;
      if (rateBglInput) rateBglInput.value = Math.round(val * 10000);
      if (rateDlInput)  rateDlInput.value  = Math.round(val * 100);
    });

    // ── SAVE RATE ──
    document.getElementById('btnSaveRate')?.addEventListener('click', () => {
      const bgl = parseFloat(rateBglInput?.value) || 100000;
      const dl  = Math.round(bgl / 100);
      const wl  = parseFloat(rateWlInput?.value) || parseFloat((bgl / 10000).toFixed(2));
      const take  = parseFloat(document.getElementById('rate-take')?.value || 0);
      const setor = parseFloat(document.getElementById('rate-setor')?.value || 0);

      state.rate = { BGL: bgl, DL: dl, WL: wl, take, setor };
      saveState();
      showToast('Pengaturan Rate berhasil disimpan!', 'success');
      updateConversionCalc();
      updateSpread();
      updateDashboard();
    });

    // ── CONVERSION CALCULATOR ──
    document.getElementById('conv-amount')?.addEventListener('input', updateConversionCalc);
    document.getElementById('conv-from')?.addEventListener('change', updateConversionCalc);
    document.getElementById('rate-take')?.addEventListener('input', updateSpread);
    document.getElementById('rate-setor')?.addEventListener('input', updateSpread);

    // ── CONFIRM MODAL ──
    document.getElementById('modalCancel')?.addEventListener('click', () => {
      document.getElementById('modalOverlay').classList.remove('show');
      confirmCallback = null;
    });
    document.getElementById('modalConfirm')?.addEventListener('click', () => {
      document.getElementById('modalOverlay').classList.remove('show');
      if (confirmCallback) { confirmCallback(); confirmCallback = null; }
    });

    // ── NEW SESSION ──
    document.getElementById('btnNewSession')?.addEventListener('click', () => {
      document.getElementById('sessionOverlay').classList.add('show');
    });
    document.getElementById('sessionCancel')?.addEventListener('click', () => {
      document.getElementById('sessionOverlay').classList.remove('show');
    });
    document.getElementById('sessionConfirm')?.addEventListener('click', () => {
      document.getElementById('sessionOverlay').classList.remove('show');
      // Save current session to history
      const snap = JSON.parse(JSON.stringify(state.currentSession));
      state.history.push(snap);
      // Reset current session
      state.currentSession = {
        date: todayStr(),
        modals: [],
        transactions: [],
        proxy: [],
      };
      saveState();
      showToast('Sesi baru dimulai! Data lama tersimpan di Riwayat.', 'success');
      navigateTo('dashboard');
    });

    // ── HISTORY MONTH FILTER ──
    document.getElementById('history-month')?.addEventListener('change', renderHistoryPage);

    // ── EXPORT ──
    document.getElementById('btnExport')?.addEventListener('click', exportData);

    // ── CLEAR ALL ──
    document.getElementById('btnClearAll')?.addEventListener('click', () => {
      showConfirm('Hapus Semua Data', 'Semua data riwayat dan sesi aktif akan dihapus permanen. Tindakan ini tidak dapat dibatalkan!', () => {
        const defState = defaultState();
        defState.rate = state.rate;
        defState.proxyIconUrl = state.proxyIconUrl;
        state = defState;
        saveState();
        showToast('Semua data berhasil dihapus', 'info');
        navigateTo('dashboard');
      });
    });

    // Close mobile sidebar on outside click
    document.addEventListener('click', (e) => {
      const sidebar = document.getElementById('sidebar');
      const btn = document.getElementById('mobileMenuBtn');
      if (sidebar?.classList.contains('mobile-open') &&
          !sidebar.contains(e.target) && !btn?.contains(e.target)) {
        sidebar.classList.remove('mobile-open');
      }
    });
  }

  // ── UPDATE DASHBOARD HELPER ─────────────────────────
  function updateDashboard() {
    if (document.getElementById('page-dashboard')?.classList.contains('active')) {
      renderDashboard();
    }
  }

  // ── EXPORT ──────────────────────────────────────────
  function exportData() {
    const data = {
      exported: new Date().toISOString(),
      currentSession: state.currentSession,
      history: state.history,
      rate: state.rate,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ptmakmur-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data berhasil diekspor!', 'success');
  }

  // ── INIT ─────────────────────────────────────────────
  function init() {
    updateDateDisplay();
    initEvents();
    updateProxyCalc();
    navigateTo('dashboard');

    // Set today's date in history month filter
    const hm = document.getElementById('history-month');
    if (hm) hm.value = todayStr().slice(0, 7);

    // Ensure session date is today (new day check)
    const sess = state.currentSession;
    if (!sess.date) sess.date = todayStr();

    // Apply proxy icon
    const display = document.getElementById('proxyIconDisplay');
    if (display) {
      const src = state.proxyIconUrl || 'icons/immortal_proxy.png';
      display.innerHTML = `<img src="${src}" class="proxy-banner-img" alt="Immortal Proxy">`;
    }
  }

  // ── AUTHENTICATION GATE ──────────────────────────────
  const AUTH_KEY = 'ptmakmur_auth_token';
  const VALID_USER = 'PTMAKMUR';
  const VALID_PASS = 'jayabersama';

  function isAuthenticated() {
    return localStorage.getItem(AUTH_KEY) === '1' || sessionStorage.getItem(AUTH_KEY) === '1';
  }

  function setAuthenticated(remember) {
    if (remember) {
      localStorage.setItem(AUTH_KEY, '1');
    } else {
      sessionStorage.setItem(AUTH_KEY, '1');
    }
  }

  function clearAuthentication() {
    localStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(AUTH_KEY);
  }

  function checkAuthOnLoad() {
    const loginScreen = document.getElementById('loginScreen');
    if (!loginScreen) return;
    if (isAuthenticated()) {
      loginScreen.classList.add('hidden');
    } else {
      loginScreen.classList.remove('hidden');
      setTimeout(() => {
        document.getElementById('loginUsername')?.focus();
      }, 100);
    }
  }

  function initLogin() {
    const form = document.getElementById('loginForm');
    const userInp = document.getElementById('loginUsername');
    const passInp = document.getElementById('loginPassword');
    const rememberCb = document.getElementById('loginRemember');
    const errorBox = document.getElementById('loginError');
    const errorText = document.getElementById('loginErrorText');
    const toggleBtn = document.getElementById('btnTogglePassword');
    const loginScreen = document.getElementById('loginScreen');
    const logoutBtn = document.getElementById('btnLogout');

    // Toggle show/hide password
    toggleBtn?.addEventListener('click', () => {
      if (passInp.type === 'password') {
        passInp.type = 'text';
        toggleBtn.textContent = '🙈';
      } else {
        passInp.type = 'password';
        toggleBtn.textContent = '👁️';
      }
    });

    // Handle login submit
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const u = (userInp?.value || '').trim();
      const p = (passInp?.value || '').trim();

      // Check username (case-insensitive) and password (exact)
      if (u.toUpperCase() === VALID_USER && p === VALID_PASS) {
        if (errorBox) errorBox.style.display = 'none';
        setAuthenticated(rememberCb?.checked);
        showToast('Login berhasil! Selamat datang di PT MAKMUR', 'success');
        loginScreen?.classList.add('hidden');
        if (passInp) passInp.value = '';
      } else {
        if (errorBox) {
          errorBox.style.display = 'flex';
          if (errorText) errorText.textContent = 'Username atau password salah! Silakan coba lagi.';
          errorBox.classList.remove('shake');
          void errorBox.offsetWidth; // re-trigger animation
          errorBox.classList.add('shake');
        }
        if (passInp) {
          passInp.value = '';
          passInp.focus();
        }
      }
    });

    // Handle logout / lock dashboard
    logoutBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      showConfirm('Kunci Dashboard', 'Keluar dan kunci dashboard dengan password?', () => {
        clearAuthentication();
        loginScreen?.classList.remove('hidden');
        if (userInp) userInp.value = '';
        if (passInp) passInp.value = '';
        if (errorBox) errorBox.style.display = 'none';
        showToast('Dashboard telah dikunci', 'info');
        setTimeout(() => {
          userInp?.focus();
        }, 150);
      });
    });
  }

  // ══════════════════════════════════════════════════
  // CLOUD SYNC — MongoDB Atlas (Live via /api/state)
  // ══════════════════════════════════════════════════
  let _lastSyncTime = 0;
  let _pollTimer    = null;
  let _isPushing    = false;

  async function pushMongoState(currState) {
    if (_isPushing || _pauseRemoteWrite) return;
    _isPushing = true;
    try {
      const res = await fetch('/api/state', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ state: currState }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.updatedAt) _lastSyncTime = data.updatedAt;
        setSyncOnline(true);
        updateSyncTime();
      } else {
        setSyncOnline(false);
      }
    } catch(err) {
      console.warn('Sync push error:', err);
      setSyncOnline(false);
    } finally {
      _isPushing = false;
    }
  }

  async function fetchMongoState(isUserTriggered = false) {
    if (_pauseRemoteWrite || _isPushing) return;
    try {
      const res = await fetch('/api/state?t=' + Date.now(), {
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      });
      if (!res.ok) {
        setSyncOnline(false);
        if (isUserTriggered) showToast('Gagal terhubung ke MongoDB server', 'error');
        return;
      }
      const data = await res.json();
      setSyncOnline(true);

      if (data.exists && data.state) {
        // Compare local vs remote to detect if local has unsynced items
        const localModals  = state.currentSession?.modals || [];
        const remoteModals = data.state?.currentSession?.modals || [];
        const localTxs     = state.currentSession?.transactions || [];
        const remoteTxs    = data.state?.currentSession?.transactions || [];
        const localProxy   = state.currentSession?.proxy || [];
        const remoteProxy  = data.state?.currentSession?.proxy || [];

        const hasNewLocalData = (
          localModals.some(m => !remoteModals.some(rm => rm.id === m.id)) ||
          localTxs.some(t => !remoteTxs.some(rt => rt.id === t.id)) ||
          localProxy.some(p => !remoteProxy.some(rp => rp.id === p.id))
        );

        if (hasNewLocalData) {
          // Device has offline/unsynced local entries -> merge and push to MongoDB Atlas!
          state = mergeStates(state, data.state);
          try { localStorage.setItem('ptmakmur_v2', JSON.stringify(state)); } catch(e) {}
          renderAll();
          pushMongoState(state);
          if (isUserTriggered) showToast('✅ Data lokal di-upload ke MongoDB!', 'success');
        } else if (data.updatedAt && data.updatedAt > _lastSyncTime) {
          // Cloud has newer data from another device (phone/laptop)!
          _lastSyncTime = data.updatedAt;
          _pauseRemoteWrite = true;
          try {
            state = mergeStates(state, data.state);
            localStorage.setItem('ptmakmur_v2', JSON.stringify(state));
            renderAll();
          } finally {
            _pauseRemoteWrite = false;
          }
          if (isUserTriggered) showToast('✅ Data disinkronkan dari MongoDB Atlas!', 'success');
        } else if (isUserTriggered) {
          showToast('Data sudah versi terbaru (up to date)', 'info');
        }
      } else if (!data.exists && state) {
        // First initialization to cloud
        pushMongoState(state);
      }
      updateSyncTime();
    } catch(err) {
      setSyncOnline(false);
      if (isUserTriggered) showToast('Koneksi offline atau server belum siap', 'error');
    }
  }

  function updateSyncTime() {
    const el = document.getElementById('syncLastUpdate');
    if (el) {
      const now = new Date();
      const count = (state.currentSession?.modals?.length || 0) +
                    (state.currentSession?.transactions?.length || 0) +
                    (state.currentSession?.proxy?.length || 0);
      el.textContent = `Sync: ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')} (${count} item)`;
    }
  }

  // ── Sync UI state indicators ──
  function getSyncDot()   { return document.getElementById('topbarSyncDot'); }
  function getSyncLabel() { return document.getElementById('topbarSyncLabel'); }
  function getSyncPill()  { return document.getElementById('sidebarSyncPill'); }

  function setSyncOnline(on) {
    const dot  = getSyncDot();
    const lbl  = getSyncLabel();
    const pill = getSyncPill();
    if (dot)  { on ? dot.classList.add('online')  : dot.classList.remove('online'); }
    if (lbl)  { lbl.textContent = on ? '🟢 MongoDB Sync' : '🔴 Sync Offline'; }
    if (pill) {
      pill.textContent = on ? 'MongoDB Aktif' : 'Offline';
      on ? pill.classList.add('online') : pill.classList.remove('online');
    }
    const dot2 = document.getElementById('syncStatusDot');
    const txt  = document.getElementById('syncStatusText');
    const sub  = document.getElementById('syncStatusSub');
    const dev  = document.getElementById('mongoDeviceStatus');
    if (dot2) dot2.style.cssText = on
      ? 'width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 10px #22c55e;display:inline-block;'
      : 'width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 10px #ef4444;display:inline-block;' ;
    if (txt) txt.textContent = on ? '🟢 MongoDB Atlas Terhubung' : '🔴 Belum Terhubung ke MongoDB';
    if (sub) sub.textContent = on
      ? 'Cluster PTMAKMUR · Database: ptmakmur'
      : 'Periksa koneksi internet atau pengaturan IP Access di Atlas.';
    if (dev) dev.textContent = on ? 'Sinkron dengan Cloud (Realtime)' : 'Mode Lokal (Offline)';
  }

  // ── Merge remote + local: deduplicate by id ──
  function mergeStates(local, remote) {
    if (!remote) return local;
    const merged = JSON.parse(JSON.stringify(remote));
    const ls = local.currentSession;
    const rs = remote.currentSession;
    if (ls && rs && ls.date === rs.date) {
      function mergeArr(a, b) {
        const map = {};
        (a || []).forEach(x => { if (x.id) map[x.id] = x; });
        (b || []).forEach(x => { if (x.id) map[x.id] = x; });
        return Object.values(map);
      }
      merged.currentSession = {
        date:         ls.date,
        modals:       mergeArr(ls.modals, rs.modals),
        transactions: mergeArr(ls.transactions, rs.transactions),
        proxy:        mergeArr(ls.proxy, rs.proxy),
      };
    } else if (ls && (!rs || ls.date > (rs?.date || ''))) {
      merged.currentSession = ls;
    }
    if (local.rate) merged.rate = local.rate;
    return merged;
  }

  // ── COPY / PASTE DATA (manual device transfer) ──
  function dataToShareCode() {
    return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
  }

  function applyShareCode(code) {
    try {
      const remote = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
      state = mergeStates(state, remote);
      saveState();
      renderAll();
      showToast('✅ Data berhasil dimuat dari kode!', 'success');
      return true;
    } catch(e) {
      showToast('Kode data tidak valid. Pastikan kamu menyalin seluruh kode.', 'error');
      return false;
    }
  }

  // ── BACKUP / RESTORE (JSON file) ──
  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `ptmakmur_backup_${todayStr()}.json`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast('💾 File cadangan berhasil diunduh!', 'success');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const remote = JSON.parse(e.target.result);
        state = mergeStates(state, remote);
        saveState(); renderAll();
        showToast('📂 File cadangan berhasil dimuat!', 'success');
      } catch(err) {
        showToast('File tidak valid atau rusak.', 'error');
      }
    };
    reader.readAsText(file);
  }

  // ── INIT CLOUD SYNC UI ──
  function initCloudSync() {
    const overlay        = document.getElementById('cloudSyncModalOverlay');
    const closeBtn       = document.getElementById('btnCloseCloudSync');
    const forceSyncBtn   = document.getElementById('btnForceSyncMongo');
    const topbarSyncBtn  = document.getElementById('topbarSyncBtn');
    const navSyncBtn     = document.getElementById('navBtnCloudSync');
    const copyBtn        = document.getElementById('btnCopyDataCode');
    const pasteArea      = document.getElementById('pasteDataCode');
    const applyBtn       = document.getElementById('btnApplyDataCode');
    const exportBtn      = document.getElementById('btnExportJson');
    const importInput    = document.getElementById('importJsonInput');

    function openModal() {
      if (!overlay) return;
      overlay.classList.add('show');
      fetchMongoState(false);
    }
    function closeModal() { overlay?.classList.remove('show'); }

    topbarSyncBtn?.addEventListener('click', openModal);
    navSyncBtn?.addEventListener('click', e => { e.preventDefault(); openModal(); });
    closeBtn?.addEventListener('click', closeModal);
    overlay?.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    // Tab switching
    document.querySelectorAll('.sync-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sync-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.sync-tab-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none'; });
        btn.classList.add('active');
        const target = document.getElementById(btn.dataset.tab);
        if (target) { target.classList.add('active'); target.style.display = 'block'; }
      });
    });

    // Manual Force Sync Button
    forceSyncBtn?.addEventListener('click', () => {
      fetchMongoState(true);
    });

    // Copy share code
    copyBtn?.addEventListener('click', () => {
      const code = dataToShareCode();
      navigator.clipboard?.writeText(code).then(() => {
        showToast('📋 Kode data disalin! Kirim via WA/Telegram.', 'success');
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = code; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('📋 Kode data disalin!', 'success');
      });
    });

    applyBtn?.addEventListener('click', () => {
      const code = pasteArea?.value?.trim();
      if (!code) { showToast('Kolom kode kosong!', 'error'); return; }
      if (applyShareCode(code)) pasteArea.value = '';
    });

    exportBtn?.addEventListener('click', exportJson);
    importInput?.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) { importJson(f); e.target.value = ''; }
    });

    // Start background auto-poll every 4 seconds
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(() => fetchMongoState(false), 4000);

    // Sync on tab focus
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        fetchMongoState(false);
      }
    });

    // Initial fetch on app start
    setTimeout(() => fetchMongoState(false), 500);
  }

  // ── PATCH saveState: also push to MongoDB on every save ──
  // (saveState already checks _fbRef from top of module,
  //  we now also push to Mongo if connected)
  // Override is handled by augmenting saveState in-place via the
  // _mongoAppId/_mongoApiKey checks inside saveState itself:
  // (see saveState definition above which calls mongoWrite if connected)

  // Run after DOM ready
  function startApp() {
    init();
    initFounderCarousel();
    initLogin();
    checkAuthOnLoad();
    initCloudSync();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }

  // ============================================================
  // FOUNDER CAROUSEL
  // ============================================================
  function initFounderCarousel() {
    const cards   = Array.from(document.querySelectorAll('.founder-card'));
    const dots    = Array.from(document.querySelectorAll('.dot'));
    const btnPrev = document.getElementById('carouselPrev');
    const btnNext = document.getElementById('carouselNext');
    if (!cards.length || !btnPrev || !btnNext) return;

    let activeIdx = 1; // VISUNA start

    function applyCarousel() {
      const n = cards.length;
      const prevIdx = (activeIdx - 1 + n) % n;
      const nextIdx = (activeIdx + 1) % n;

      cards.forEach((card, i) => {
        card.classList.remove('fc-active', 'fc-prev', 'fc-next', 'fc-hidden');
        if      (i === activeIdx) card.classList.add('fc-active');
        else if (i === prevIdx)   card.classList.add('fc-prev');
        else if (i === nextIdx)   card.classList.add('fc-next');
        else                      card.classList.add('fc-hidden');
      });

      dots.forEach((d, i) => d.classList.toggle('active', i === activeIdx));
    }

    btnPrev.addEventListener('click', () => {
      activeIdx = (activeIdx - 1 + cards.length) % cards.length;
      applyCarousel();
    });
    btnNext.addEventListener('click', () => {
      activeIdx = (activeIdx + 1) % cards.length;
      applyCarousel();
    });

    cards.forEach((card, i) => {
      card.addEventListener('click', () => {
        if (i !== activeIdx) { activeIdx = i; applyCarousel(); }
      });
    });

    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => { activeIdx = i; applyCarousel(); });
    });

    // Swipe
    let tx = 0;
    const wrap = document.getElementById('foundersCarousel');
    wrap.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
    wrap.addEventListener('touchend', e => {
      const diff = tx - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 40) {
        activeIdx = diff > 0
          ? (activeIdx + 1) % cards.length
          : (activeIdx - 1 + cards.length) % cards.length;
        applyCarousel();
      }
    });

    applyCarousel();
  }

})();
