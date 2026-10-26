(function (root) {
  'use strict';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function normalizeCalibration(input) {
    let points;
    if (Array.isArray(input.points)) {
      points = input.points.map(p => ({ power_mw: p.power_mw, adc_code: p.adc_code }));
    } else if (Array.isArray(input.piecewise_code_nodes) && Array.isArray(input.piecewise_power_mw_nodes)) {
      if (input.piecewise_code_nodes.length !== input.piecewise_power_mw_nodes.length) throw Error('标定节点数量不一致');
      points = input.piecewise_code_nodes.map((c, i) => ({ power_mw: input.piecewise_power_mw_nodes[i], adc_code: 16383 - c }));
    } else throw Error('标定文件需要 points，或原有的两组 piecewise 节点');
    if (points.length < 2 || points.length > 4096) throw Error('标定需要 2–4096 个节点');
    if (points.some(p => !finite(p.power_mw) || !finite(p.adc_code) || p.adc_code < 0 || p.adc_code > 16383)) throw Error('标定中存在无效功率或超出 14 位范围的 ADC 码');
    points.sort((a, b) => a.power_mw - b.power_mw);
    const direction = Math.sign(points[1].adc_code - points[0].adc_code);
    if (!direction || points.some((p, i) => i && (p.power_mw <= points[i - 1].power_mw || Math.sign(p.adc_code - points[i - 1].adc_code) !== direction))) throw Error('功率与 ADC 码必须严格单调，不能重复或折返');
    if (points[points.length - 1].power_mw <= 0) throw Error('标定必须包含正功率');
    const encoding = input.encoding || (input.piecewise_code_nodes ? 'pi_unsigned_14' : null);
    if (encoding !== 'pi_unsigned_14') throw Error('points 标定必须声明 encoding: pi_unsigned_14（PI 内部 14 位无符号码）');
    return { name: String(input.name || '导入的功率标定').slice(0, 100), encoding, wavelength_nm: input.wavelength_nm ?? null, source: String(input.source || input.source_session || '用户导入').slice(0, 250), historical: !!input.historical, points };
  }
  function interpolate(points, value, x, y) {
    if (!finite(value)) throw Error('请输入有效数字');
    const sorted = [...points].sort((a, b) => a[x] - b[x]);
    if (value < sorted[0][x] || value > sorted[sorted.length - 1][x]) throw Error('超出标定范围，不能外推');
    for (let i = 1; i < sorted.length; i++) {
      if (value <= sorted[i][x]) {
        const a = sorted[i - 1], b = sorted[i];
        return a[y] + (value - a[x]) * (b[y] - a[y]) / (b[x] - a[x]);
      }
    }
    return sorted[sorted.length - 1][y];
  }
  const toCode = (cal, power) => Math.round(interpolate(cal.points, power, 'power_mw', 'adc_code'));
  const toPower = (cal, code) => interpolate(cal.points, code, 'adc_code', 'power_mw');
  function estimateRange({ reference, efficiency, minimum, maximum, margin }) {
    if (![reference, efficiency, minimum, maximum, margin].every(finite) || reference <= 0 || minimum <= 0 || minimum >= maximum || maximum > 100 || efficiency < minimum || efficiency > maximum || margin < 0 || margin >= 50) throw Error('请检查参考功率、效率与余量；参考效率必须在最小和最大效率之间');
    const low = reference * minimum / efficiency, high = reference * maximum / efficiency;
    return { low, high, recommendedLow: low + (high - low) * margin / 100, recommendedHigh: high - (high - low) * margin / 100 };
  }
  function ramp(current, target, rate, seconds) {
    if (![current, target, rate, seconds].every(finite) || rate <= 0 || seconds < 0) throw Error('斜坡速率必须大于 0');
    return current + Math.sign(target - current) * Math.min(Math.abs(target - current), rate * seconds);
  }
  function stats(values, target) {
    const a = values.filter(finite);
    if (!a.length) return { mean: null, rms: null, pp: null };
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    return { mean, rms: target > 0 ? Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length) / target * 100 : null, pp: Math.max(...a) - Math.min(...a) };
  }
  function parseCalibration(text, filename) {
    if (/\.csv$/i.test(filename)) {
      const rows = text.trim().replace(/^\uFEFF/, '').split(/\r?\n/).map(r => r.split(',').map(s => s.trim()));
      if (rows[0].join(',') !== 'power_mw,adc_code') throw Error('CSV 表头应为 power_mw,adc_code，ADC 需为 PI 内部码');
      return normalizeCalibration({ name: filename, encoding: 'pi_unsigned_14', points: rows.slice(1).map(r => ({ power_mw: Number(r[0]), adc_code: Number(r[1]) })) });
    }
    return normalizeCalibration(JSON.parse(text));
  }
  const api = { finite, normalizeCalibration, interpolate, toCode, toPower, estimateRange, ramp, stats, parseCalibration };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MotCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
