(function () {
  'use strict';
  const C = MotCore, $ = id => document.getElementById(id), all = q => [...document.querySelectorAll(q)];
  const fmt = (v, n = 2) => C.finite(v) ? v.toFixed(n) : '-';
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = n => `<svg aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const defaultConfig = id => ({ efficiency: id === '556' ? 75.42 : null, transmission: null, minimum: id === '556' ? 60 : null, maximum: id === '556' ? 85 : null, margin: 5, tolerance: 1 });
  function validateConfig(value) {
    for (const k of ['efficiency', 'transmission', 'minimum', 'maximum']) if (value[k] !== null && !(C.finite(value[k]) && value[k] > 0 && value[k] <= 100)) throw Error('效率及透过率需大于 0 且不超过 100%，未知可留空');
    if (!C.finite(value.margin) || !(value.margin >= 0 && value.margin < 50) || !C.finite(value.tolerance) || !(value.tolerance >= .01 && value.tolerance <= 20)) throw Error('请检查预留余量与误差带');
    if ([value.efficiency, value.minimum, value.maximum].every(C.finite)) C.estimateRange({ ...value, reference: 10 });
  }
  function makeChannel(id) {
    let config = defaultConfig(id), calibration = id === '556' ? C.normalizeCalibration(MOT_DEFAULT_CALIBRATION) : null;
    try {
      const saved = JSON.parse(localStorage.getItem(`mot-pid-optics-${id}-v1`) || (id === '556' ? localStorage.getItem('mot556-optics-v1') : null) || 'null');
      if (saved) { validateConfig(saved); config = { ...config, ...saved }; }
      const savedCal = JSON.parse(localStorage.getItem(`mot-pid-calibration-${id}-v1`) || 'null');
      if (savedCal && savedCal.wavelength_nm === Number(id)) calibration = C.normalizeCalibration(savedCal);
    } catch {}
    return { id, config, calibration, target: id === '556' ? 10 : null, draft: id === '556' ? '10.00' : '', rate: '2.0', port: id === '556' ? 'COM9' : '', serial: id === '556' ? 'P2007293' : '', chosen: false, applied: false, snapshot: null, polling: false, busy: false, history: [], window: 60, paused: false, pauseTime: 0, lastMeter: null, lastAdc: null, error: '', previousConnected: false };
  }
  const channels = { '556': makeChannel('556'), '399': makeChannel('399') };
  let channelId = '556';
  const current = () => channels[channelId];
  const anyBusy = () => Object.values(channels).some(c => c.busy);
  function toast(message, bad = false) { const el = document.createElement('div'); el.className = 'toast' + (bad ? ' error' : ''); el.innerHTML = icon(bad ? 'info' : 'check') + `<span>${escape(message)}</span>`; $('toast-stack').append(el); setTimeout(() => el.remove(), 4200); }
  async function api(path, body, id = channelId) {
    if (!/^https?:$/.test(location.protocol)) throw Error('请双击 start.cmd，通过本机网页连接设备');
    const response = await fetch(`${path}?channel=${encodeURIComponent(id)}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-MOT-Console': '1' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000), cache: 'no-store' });
    let value; try { value = await response.json(); } catch { throw Error('本机服务未启动，请双击 start.cmd'); }
    if (!response.ok) throw Error(value.error || '设备服务异常');
    if (value.app !== 'mot556-console') throw Error('此地址不是 MOT 控制台设备服务');
    return value;
  }
  const fresh = d => !!(d?.connected && C.finite(d.sampled_at) && Date.now() - d.sampled_at < 2500);
  function readings(s = current()) {
    const f = s.snapshot?.fpga, m = s.snapshot?.meter; let adcPower = null;
    if (fresh(f) && s.calibration) { try { adcPower = C.toPower(s.calibration, f.adc_code); } catch {} }
    return { f, m, power: fresh(m) ? m.power_mw : null, adcPower, fpgaLive: fresh(f), meterLive: fresh(m) };
  }
  function loadControls() {
    const s = current(); $('target-input').value = s.draft; $('ramp-rate').value = s.rate;
    $('target-input').max = s.calibration ? s.calibration.points.at(-1).power_mw : 100000;
    $('serial-port').value = s.port; $('meter-serial').value = s.serial;
    all('[data-window]').forEach(b => b.classList.toggle('active', Number(b.dataset.window) === s.window));
    $('pause-chart').innerHTML = icon(s.paused ? 'play' : 'pause'); preview();
  }
  function switchChannel(id) {
    if (!channels[id] || id === channelId || anyBusy()) return;
    const s = current(); s.draft = $('target-input').value; s.rate = $('ramp-rate').value;
    channelId = id; $('target-error').textContent = ''; loadControls(); render();
  }
  all('[data-channel]').forEach(b => b.onclick = () => switchChannel(b.dataset.channel));
  function preview() {
    const s = current(), value = $('target-input').value.trim();
    const n = value === '' ? NaN : Number(value);
    try {
      if (value && (!C.finite(n) || n < 0)) throw Error('目标功率需为非负数字');
      $('code-preview').textContent = s.calibration && value ? C.toCode(s.calibration, n) : '-';
      $('target-error').textContent = '';
    } catch (e) { $('code-preview').textContent = '-'; $('target-error').textContent = e.message; }
    all('[data-preset]').forEach(b => b.classList.toggle('selected', Number(b.dataset.preset) === n));
  }
  $('target-input').addEventListener('input', () => { current().chosen = true; current().draft = $('target-input').value; preview(); });
  for (const [id, step] of [['target-minus', -.1], ['target-plus', .1]]) $(id).onclick = () => { $('target-input').value = Math.max(0, Number($('target-input').value || 0) + step).toFixed(2); current().chosen = true; current().draft = $('target-input').value; preview(); };
  all('[data-preset]').forEach(b => b.onclick = () => { $('target-input').value = Number(b.dataset.preset).toFixed(2); current().chosen = true; current().draft = $('target-input').value; preview(); });
  $('setpoint-form').onsubmit = async e => {
    e.preventDefault(); if (anyBusy()) return;
    const s = current(), id = channelId;
    try {
      const value = $('target-input').value, target = Number(value), rate = Number($('ramp-rate').value);
      if (!value.trim() || !C.finite(target) || target < 0) throw Error('请输入非负目标功率');
      if (s.calibration) C.toCode(s.calibration, target);
      if (!(rate >= .01 && rate <= 100)) throw Error('变化速率为 0.01–100 mW/s');
      s.busy = true; render();
      if (s.snapshot?.fpga.connected) {
        if (!s.calibration) throw Error(`请先导入 ${id} nm 本路标定，再应用目标`);
        const result = await api('/api/target', { power_mw: target, rate_mw_s: rate, calibration: s.calibration }, id);
        s.snapshot = result.state; s.applied = true; toast(`${id} nm 目标已接收，正在斜坡更新并读回`);
      } else { s.applied = false; toast(`${id} nm 目标已保存，尚未下发到设备`); }
      s.target = target; s.draft = value; s.rate = String(rate); s.chosen = true;
    } catch (err) { $('target-error').textContent = err.message; toast(err.message, true); }
    finally { s.busy = false; render(); }
  };
  async function setPi(enabled) {
    if (anyBusy()) return; const s = current(), id = channelId; s.busy = true; render();
    try { s.snapshot = (await api('/api/pi', { enabled }, id)).state; toast(enabled ? `${id} nm PI 已使能并读回` : `${id} nm PI 已停用；RF 与光源未关闭`); }
    catch (e) { toast(e.message, true); } finally { s.busy = false; render(); }
  }
  $('pi-toggle').onclick = () => setPi(!current().snapshot?.fpga.pi_enabled); $('stop-loop').onclick = () => setPi(false);
  all('.close-dialog').forEach(b => b.onclick = () => b.closest('dialog').close());
  all('dialog').forEach(d => d.onclick = e => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); } });
  $('help-button').onclick = () => $('help-dialog').showModal(); $('nav-overview').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  async function inspectService() {
    try { const value = await api('/api/ports'); $('serial-ports').innerHTML = value.ports.map(p => `<option value="${escape(p.device)}">${escape(p.description)}</option>`).join(''); $('service-state').textContent = `本机服务就绪 · 发现 ${value.ports.length} 个串口`; }
    catch (e) { $('service-state').textContent = e.message; }
  }
  function openConnect() { const s = current(); $('serial-port').value = s.port; $('meter-serial').value = s.serial; $('connection-error').textContent = ''; $('connection-feedback').textContent = `${channelId} nm · 连接时只读，不自动应用目标。`; $('connect-dialog').showModal(); inspectService(); }
  ['connect-button', 'notice-action', 'nav-devices'].forEach(id => $(id).onclick = openConnect); $('refresh-ports').onclick = inspectService;
  $('serial-port').addEventListener('input', () => { current().port = $('serial-port').value.trim(); });
  $('meter-serial').addEventListener('input', () => { current().serial = $('meter-serial').value.trim(); });
  async function connect(kind) {
    if (anyBusy()) return; const s = current(), id = channelId;
    s.port = $('serial-port').value.trim(); s.serial = $('meter-serial').value.trim(); s.busy = true;
    $('connection-error').textContent = ''; $('connection-feedback').textContent = '正在连接并读取设备…'; render();
    try {
      const connected = kind === 'fpga' ? s.snapshot?.fpga.connected : s.snapshot?.meter.connected;
      const value = connected ? await api(`/api/disconnect/${kind}`, {}, id) : await api(`/api/connect/${kind}`, kind === 'fpga' ? { port: s.port } : { serial: s.serial }, id);
      accept(value.state, id); $('connection-feedback').textContent = connected ? '设备已断开，相关读数已清空。' : kind === 'fpga' ? `${id} nm FPGA 已连接，未自动修改目标。` : `功率计已连接，${id} nm 已回读。`;
      toast(connected ? `${id} nm 设备已断开` : `${id} nm ${kind === 'fpga' ? 'FPGA' : '功率计'}已连接`);
    } catch (e) { $('connection-error').textContent = e.message; $('connection-feedback').textContent = '连接未完成'; toast(e.message, true); }
    finally { s.busy = false; render(); }
  }
  $('connect-fpga').onclick = () => connect('fpga'); $('connect-meter').onclick = () => connect('meter');
  function accept(snapshot, id) {
    const s = channels[id], f = snapshot.fpga, m = snapshot.meter;
    if (f.connected && !s.previousConnected) {
      if (!s.chosen && s.calibration) { try { s.target = C.toPower(s.calibration, f.setpoint_code); s.draft = s.target.toFixed(2); s.applied = true; if (id === channelId) { $('target-input').value = s.draft; preview(); } } catch {} }
      else s.applied = false;
    }
    if (!f.connected) s.applied = false;
    s.previousConnected = !!f.connected; s.snapshot = snapshot;
    const error = [f.error, m.error].filter(Boolean).join('；'); if (error && error !== s.error) toast(`${id} nm · ${error}`, true); s.error = error;
    const r = readings(s), newM = fresh(m) && m.sampled_at !== s.lastMeter, newF = fresh(f) && f.sampled_at !== s.lastAdc;
    if (newM || newF) { s.history.push({ time: Date.now(), power: newM ? r.power : null, adc: newF ? r.adcPower : null, target: s.target }); if (newM) s.lastMeter = m.sampled_at; if (newF) s.lastAdc = f.sampled_at; if (s.history.length > 3000) s.history.splice(0, s.history.length - 3000); }
  }
  async function poll(id) {
    const s = channels[id]; if (s.polling || !/^https?:$/.test(location.protocol)) return; s.polling = true;
    try { accept((await api('/api/state', undefined, id)).state, id); }
    catch { s.snapshot = null; s.applied = false; s.previousConnected = false; }
    finally { s.polling = false; if (id === channelId) render(); }
  }
  function openParameters() { const s = current(); Object.keys(s.config).forEach(k => { $('range-form').elements[k].value = s.config[k] ?? ''; }); $('range-error').textContent = ''; $('range-dialog').showModal(); }
  $('range-settings').onclick = openParameters; $('nav-parameters').onclick = openParameters;
  $('range-form').onsubmit = e => {
    e.preventDefault(); const s = current(), f = e.currentTarget;
    const next = Object.fromEntries(Object.keys(s.config).map(k => [k, !f.elements[k].value.trim() ? null : Number(f.elements[k].value)]));
    try { validateConfig(next); s.config = next; try { localStorage.setItem(`mot-pid-optics-${channelId}-v1`, JSON.stringify(next)); } catch {} $('range-dialog').close(); toast(`${channelId} nm 光路参数已保存`); render(); }
    catch (err) { $('range-error').textContent = err.message; }
  };
  $('channel-calibration-file').onchange = async event => {
    const file = event.target.files[0], s = current(), id = channelId; if (!file || anyBusy()) return;
    try {
      if (s.snapshot?.fpga.ramp) throw Error('请等待目标斜坡完成后再切换标定');
      if (file.size > 2000000) throw Error('标定文件不能大于 2 MB');
      const input = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      if (input.wavelength_nm !== Number(id)) throw Error(`标定文件须声明 wavelength_nm: ${id}，不能跨通道复用`);
      const calibration = C.normalizeCalibration(input); s.calibration = calibration; s.history = []; s.lastAdc = null; s.lastMeter = null;
      try { localStorage.setItem(`mot-pid-calibration-${id}-v1`, JSON.stringify(calibration)); } catch {}
      loadControls(); render(); toast(`${id} nm 标定已载入，未修改设备目标`);
    } catch (e) { toast(e.message, true); } finally { event.target.value = ''; }
  };
  function renderRange(power) {
    const s = current(), config = s.config; let range = null;
    if (C.finite(power) && power > 0) { try { range = C.estimateRange({ ...config, reference: power }); } catch {} }
    const upstream = C.finite(power) && power >= 0 && config.efficiency > 0 && config.transmission > 0 ? power / (config.efficiency / 100 * config.transmission / 100) : null;
    $('upstream-metric').textContent = fmt(upstream);
    $('upstream-note').textContent = !C.finite(power) ? '等待功率计与光路参数' : !config.efficiency || !config.transmission ? '当前效率或透过率未知' : `η ${config.efficiency}% · T ${config.transmission}%`;
    $('range-values').innerHTML = range ? `${fmt(range.low)} <span>–</span> ${fmt(range.high)}` : '-';
    $('range-recommend').textContent = range ? `建议稳定区间 ${fmt(range.recommendedLow)}–${fmt(range.recommendedHigh)} mW` : '建议稳定区间 -';
    $('range-low').textContent = range ? fmt(range.low) : '-'; $('range-high').textContent = range ? fmt(range.high) : '-';
    $('range-marker').hidden = !range || !C.finite(s.target);
    const track = document.querySelector('.range-recommended'); track.style.opacity = range ? '1' : '.2'; track.style.left = config.margin + '%'; track.style.right = config.margin + '%';
    if (range && C.finite(s.target)) { const outside = s.target < range.low || s.target > range.high; $('range-marker').style.left = Math.max(0, Math.min(100, (s.target - range.low) / (range.high - range.low) * 100)) + '%'; $('range-marker').style.background = outside ? '#b67c25' : '#176e58'; $('range-target-label').textContent = outside ? '目标超出估算范围' : `目标 ${fmt(s.target)} mW`; }
    else $('range-target-label').textContent = !C.finite(power) ? '等待功率计数据' : !range ? '等待效率范围参数' : '尚未设置目标';
    $('range-note').textContent = range ? `按实测 ${fmt(power)} mW、手填当前效率 ${config.efficiency}%、可调效率 ${config.minimum}%–${config.maximum}% 估算。改变 RF / DAC 后须更新效率，下游透过率须稳定。` : '未连接功率计或尚缺本路效率参数，相关估算显示“-”。各路独立设置，不使用其他波长参数。';
  }
  function statusText(status) { const a = [[1, '丢光'], [2, 'ADC 过量程'], [4, '输出饱和'], [8, '积分到限'], [16, '反馈冻结'], [32, 'ADC 时钟停止']].filter(([b]) => status & b).map(([, s]) => s); return a.length ? a.join(' / ') : '正常'; }
  function render() {
    const s = current(), config = s.config, cal = s.calibration, r = readings(s), f = r.f, m = r.m, busy = anyBusy();
    $('clock').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Hong_Kong' });
    $('channel-title').textContent = `${channelId} nm MOT`; $('workspace-channel').textContent = `${channelId} nm MOT`; $('workspace-number').textContent = channelId === '556' ? '01' : '02'; $('footer-channel').textContent = `${channelId} nm MOT`;
    document.title = `${channelId} nm MOT · PID Control Console`;
    $('connect-dialog-title').textContent = `连接 ${channelId} nm 设备`; $('range-dialog-title').textContent = `${channelId} nm · AOM 功率与范围估算`;
    $('meter-wavelength-note').textContent = `使用本机 TLPMX 64 位驱动，连接后设置并回读 ${channelId} nm。`;
    all('[data-channel]').forEach(b => { const selected = b.dataset.channel === channelId; b.classList.toggle('active', selected); b.setAttribute('aria-selected', String(selected)); b.disabled = busy; });
    $('mode-text').textContent = f?.connected || m?.connected ? '设备模式' : '设备未连接';
    $('target-metric').textContent = fmt(s.target); $('target-foot').textContent = s.applied && r.fpgaLive ? (f.ramp ? '正在斜坡更新 · 读回校验' : 'FPGA 目标已读回') : C.finite(s.target) ? '仅本地设定 · 未下发' : '尚未设置目标';
    $('power-metric').textContent = fmt(r.power); $('meter-tag').textContent = r.meterLive ? '实测' : m?.connected ? '等待读数' : '未连接';
    const deviation = C.finite(r.power) && s.target > 0 ? (r.power - s.target) / s.target * 100 : null;
    $('error-metric').textContent = C.finite(deviation) ? `${deviation >= 0 ? '+' : ''}${fmt(deviation)}%` : '-';
    $('lock-tag').textContent = C.finite(deviation) ? Math.abs(deviation) <= config.tolerance ? '误差带内' : '超出误差带' : '未测量'; $('lock-tag').classList.toggle('warn', C.finite(deviation) && Math.abs(deviation) > config.tolerance);
    $('tolerance-foot').innerHTML = `<i></i>误差带 ±${fmt(config.tolerance)}%`;
    $('adc-code').textContent = r.fpgaLive ? f.adc_code : '-'; $('adc-target').textContent = r.fpgaLive ? f.setpoint_code : '-'; $('dac-code').textContent = r.fpgaLive ? f.dac_code : '-'; $('adc-power').innerHTML = fmt(r.adcPower) + '<small> mW</small>';
    $('readback-label').textContent = r.fpgaLive ? '14 位数字码 · 设备读回' : '等待 FPGA 连接'; $('dac-detail').textContent = r.fpgaLive ? '实际输出读回' : '未连接';
    $('pi-toggle').classList.toggle('on', !!(r.fpgaLive && f.pi_enabled)); $('pi-toggle').setAttribute('aria-checked', String(!!(r.fpgaLive && f.pi_enabled))); $('pi-toggle').disabled = busy || !r.fpgaLive; $('stop-loop').disabled = busy || !r.fpgaLive || !f.pi_enabled;
    $('loop-status').textContent = r.fpgaLive ? (f.status & 63 ? statusText(f.status) : f.pi_enabled ? '反馈已使能' : '反馈已停用') : '未连接'; $('loop-status').classList.toggle('warn', r.fpgaLive && !!(f.status & 63));
    $('efficiency-detail').innerHTML = C.finite(config.efficiency) ? fmt(config.efficiency) + '% <small>手填参考值</small>' : '<small>本路尚未填写</small>';
    $('apply-target').innerHTML = (f?.connected ? '应用目标功率' : '保存目标设定') + ' ' + icon('arrow'); $('apply-target').disabled = busy || !!(f?.connected && !cal);
    $('apply-hint').textContent = !cal ? `应用 ${channelId} nm 目标前，需导入本路标定。` : f?.connected ? '在线斜坡更新，无需重新生成 bitstream。' : '连接本路 FPGA 后可在线应用目标光功率。';
    $('channel-calibration-status').textContent = cal ? `${channelId} nm · ${cal.points.length - 1} 段标定` : `${channelId} nm · 待标定`;
    $('channel-calibration-status').classList.toggle('channel-calibration-missing', !cal);
    $('calibration-summary').textContent = cal ? `${channelId} nm · ${cal.points.length - 1} 段标定` : `${channelId} nm 本路标定待载入`;
    $('calibration-summary-sub').textContent = cal ? cal.historical ? '2026-10-20 历史数据，使用前核对光路' : '已载入本路独立标定' : '不套用 556 nm 标定，换算值显示“-”';
    $('live-label').innerHTML = '<span class="small-dot"></span>' + (s.paused ? '显示已暂停' : r.meterLive || r.fpgaLive ? '实时监测' : '等待连接');
    $('fpga-dot').classList.toggle('connected', r.fpgaLive); $('pm-dot').classList.toggle('connected', r.meterLive);
    $('fpga-strip').textContent = f?.connected ? f.port + (r.fpgaLive ? ' · 已连接' : ' · 数据过期') : '未连接'; $('pm-strip').textContent = m?.connected ? (m.identity?.model || 'Thorlabs') + (r.meterLive ? ` · ${channelId} nm` : ' · 等待读数') : '未连接'; $('last-update').textContent = r.meterLive || r.fpgaLive ? '数据更新中' : '尚无设备读数';
    $('connect-fpga').textContent = f?.connected ? '断开 FPGA' : '连接 FPGA'; $('connect-meter').textContent = m?.connected ? '断开功率计' : '连接功率计'; $('connect-fpga').disabled = busy; $('connect-meter').disabled = busy;
    renderRange(r.power); if (!s.paused) renderChart();
  }
  function renderChart() {
    const s = current(), config = s.config, end = s.paused ? s.pauseTime : Date.now(), start = end - s.window * 1000, data = s.history.filter(d => d.time >= start && d.time <= end), nominal = s.target || 1;
    const values = data.flatMap(d => [d.power, d.adc, d.target]).filter(C.finite);
    let low = Math.min(nominal * (1 - config.tolerance / 100), ...(values.length ? values : [nominal])), high = Math.max(nominal * (1 + config.tolerance / 100), ...(values.length ? values : [nominal]));
    const pad = Math.max((high - low) * .3, .04); low = Math.max(0, low - pad); high += pad;
    const x = t => 58 + (t - start) / (end - start) * 760, y = v => 208 - (v - low) / (high - low) * 180;
    let out = '<defs><clipPath id="plot-clip"><rect x="57" y="23" width="763" height="187"/></clipPath></defs>';
    for (let i = 0; i <= 4; i++) { const v = low + (high - low) * i / 4, yy = y(v); out += `<path d="M58 ${yy}H818" stroke="#edf1ee"/><text x="46" y="${yy + 3}" text-anchor="end">${fmt(v, high - low > 5 ? 1 : 2)}</text>`; }
    for (let i = 0; i <= 5; i++) out += `<text x="${58 + i / 5 * 760}" y="236" text-anchor="${i === 0 ? 'start' : i === 5 ? 'end' : 'middle'}">${i === 5 ? '现在' : '-' + Math.round(s.window * (1 - i / 5)) + 's'}</text>`;
    const top = y(nominal * (1 + config.tolerance / 100)), bottom = y(nominal * (1 - config.tolerance / 100));
    out += `<g clip-path="url(#plot-clip)"><rect x="58" y="${top}" width="760" height="${bottom - top}" fill="#edf5ef"/>`;
    if (C.finite(s.target)) out += `<path d="M58 ${y(s.target)}H818" stroke="#b6c5b2" stroke-dasharray="5 5"/>`;
    for (const [key, color, width] of [['adc', '#a5bfca', 1.2], ['power', '#31846b', 1.7]]) {
      let path = '', previous = null;
      for (const d of data) { if (!C.finite(d[key])) continue; path += (previous && d.time - previous.time < 2500 ? 'L' : 'M') + x(d.time).toFixed(2) + ',' + y(d[key]).toFixed(2); previous = d; }
      if (path) out += `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/>`;
    }
    out += '</g>';
    if (!data.some(d => C.finite(d.power) || C.finite(d.adc))) out += '<rect x="244" y="88" width="360" height="57" rx="8" fill="#fff" fill-opacity=".95"/><text x="424" y="112" text-anchor="middle" style="font:12px Microsoft YaHei,sans-serif;fill:#8da497">等待本路设备连接</text><text x="424" y="133" text-anchor="middle" style="font:10px Microsoft YaHei,sans-serif;fill:#b0bdb4">功率计未连接时，读数与估算显示“-”</text>';
    $('trend-svg').innerHTML = out;
    const measured = data.map(d => d.power).filter(C.finite), stats = C.stats(measured, s.target);
    $('stat-mean').innerHTML = fmt(stats.mean, 3) + '<small> mW</small>'; $('stat-rms').innerHTML = fmt(stats.rms, 3) + '<small> %</small>'; $('stat-pp').innerHTML = fmt(stats.pp, 3) + '<small> mW</small>'; $('stat-count').innerHTML = measured.length + '<small> 点</small>';
  }
  all('[data-window]').forEach(b => b.onclick = () => { current().window = Number(b.dataset.window); all('[data-window]').forEach(x => x.classList.toggle('active', x === b)); renderChart(); });
  $('pause-chart').onclick = () => { const s = current(); s.paused = !s.paused; s.pauseTime = Date.now(); $('pause-chart').innerHTML = icon(s.paused ? 'play' : 'pause'); $('pause-chart').setAttribute('aria-label', s.paused ? '继续显示' : '暂停显示'); renderChart(); render(); };
  loadControls(); render();
  const pollAll = () => { for (const id of Object.keys(channels)) poll(id); };
  pollAll(); setInterval(pollAll, 600); setInterval(render, 500);
})();
