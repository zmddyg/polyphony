import { mzmTransfer, mzmRfSimulation } from '../core/optics.mjs';

const path = (values, ymax = 1) => values.map((v, i) => `${i ? 'L' : 'M'}${(38 + i / (values.length - 1) * 414).toFixed(2)} ${(139 - 116 * v / ymax).toFixed(2)}`).join(' ');
const chart = (title, type) => `<figure><figcaption>${title}</figcaption><svg viewBox="0 0 480 170" role="img" aria-label="${title}">
  <g class="mzm-grid"><path d="M38 23H452M38 81H452M38 139H452M38 23V139M245 23V139M452 23V139"/></g>
  <g class="mzm-axis"><text x="30" y="28" text-anchor="end">100%</text><text x="30" y="143" text-anchor="end">0%</text><text x="38" y="162">0</text><text x="245" y="18" text-anchor="middle"><tspan>P/P</tspan><tspan baseline-shift="sub" font-size="9">in</tspan></text><text x="452" y="162" text-anchor="end">${type === 'transfer' ? '360°' : 't / T = 1'}</text></g>
  ${type === 'transfer' ? '<g class="mzm-swing"><rect data-mzm-band y="23" height="116"/><rect data-mzm-band-wrap y="23" height="116"/></g>' : ''}
  <path data-mzm-${type} class="mzm-curve"/>${type === 'transfer' ? '<path data-mzm-port-b class="mzm-curve mzm-curve-b"/><path data-mzm-slope class="mzm-slope"/><circle data-mzm-marker r="5" class="mzm-marker"/>' : ''}
</svg></figure>`;

export function mountMzmInstrument(root, { compact = false } = {}) {
  let lossDb = 3, biasDeg = 90, rfRatio = 0.2;
  root.innerHTML = `<section class="mzm-instrument${compact ? ' mzm-compact' : ''}" aria-label="非理想 MZM 微仪器">
    <header><div><h3>${compact ? 'MZM 光强调制微仪器' : '01 非理想 MZM 实时示波台'}</h3><p>拖动偏置，看基频如何折叠成倍频</p></div><span class="mzm-tag">确定性物理引擎</span></header>
    <div class="mzm-settings">
      <label>单臂额外损耗 α <output data-mzm-loss-readout>3.00 dB</output><input data-mzm-loss type="range" min="0" max="10" step="0.01" value="3" aria-label="单臂额外损耗 α"></label>
      <div class="mzm-bias-control"><label>直流偏置相位 φ₀ <output data-mzm-bias-readout>90°</output><input data-mzm-bias type="range" min="0" max="360" step="1" value="90" aria-label="直流偏置相位 φ₀"></label>${compact ? '' : '<div class="mzm-bias-presets" aria-label="偏置工作点"><button type="button" data-mzm-preset="0" aria-pressed="false">0° 峰值</button><button type="button" data-mzm-preset="90" aria-pressed="true">90° 正交</button><button type="button" data-mzm-preset="180" aria-pressed="false">180° 谷底</button></div>'}</div>
      ${compact ? '' : '<label>射频幅值 V<sub>RF</sub>/V<sub>π</sub> <output data-mzm-rf-readout>0.20</output><input data-mzm-rf type="range" min="0.05" max="0.50" step="0.01" value="0.20" aria-label="射频电压与半波电压之比"></label>'}
    </div>
    <div class="mzm-charts">${chart('静态传输 · P / Pᵢₙ', 'transfer')}${chart('输出光功率 · 一个射频周期', 'waveform')}</div>
    ${compact ? '' : `<p class="mzm-band-legend">琥珀色带：φ₀ ± πV<sub>RF</sub>/V<sub>π</sub> 调制摆幅 · 白点：偏置工作点 · 白线：局部斜率</p><figure class="mzm-spectrum"><figcaption>实时 DFT 谐波谱 <span>柱高按当前最强谐波归一化，绝对幅值见读数</span></figcaption><svg viewBox="0 0 720 160" role="img" aria-label="1f 2f 3f 实时谐波柱状图"><path class="mzm-grid" d="M45 125H690M45 65H690M45 10V125"/>${[1,2,3].map((k,i)=>`<rect data-mzm-harmonic="${k}" x="${100+i*215}" width="75" y="125" height="0" rx="3"/><text x="${137.5+i*215}" y="151" text-anchor="middle">${k}f</text><text data-mzm-amplitude="${k}" x="${137.5+i*215}" y="16" text-anchor="middle"></text>`).join('')}</svg></figure>`}
    <dl class="mzm-readings"><div><dt>静态 ER</dt><dd><output data-mzm-er></output><small> dB</small></dd></div><div><dt>总输出 P / Pᵢₙ</dt><dd><output data-mzm-total></output></dd></div><div><dt>V<sub>bias</sub> / V<sub>π</sub></dt><dd><output data-mzm-bias-ratio></output></dd></div></dl>
    <div class="mzm-harmonics" aria-label="DFT 谐波幅值"><span>1f <output data-mzm-h1></output></span><span>2f <output data-mzm-h2></output></span><span>3f <output data-mzm-h3></output></span></div>
    <p class="mzm-insight" data-mzm-insight role="status"></p>
    <p class="mzm-scope">两只理想 50:50 耦合器，单臂附加损耗，准静态电光响应。DFT：128 点、幅值按 2/N 归一化；不含行波带宽与噪声模型。</p>
  </section>`;
  const nodes = new Map();
  const find = selector => { if (!nodes.has(selector)) nodes.set(selector, root.querySelector(selector)); return nodes.get(selector); };
  const set = (name, value) => { find(`[data-mzm-${name}]`).textContent = value; };
  function paint() {
    const dc = mzmTransfer({ lossDb, phaseDeg: biasDeg });
    const rf = mzmRfSimulation({ lossDb, biasDeg, rfRatio });
    const curve = Array.from({ length: 73 }, (_, i) => mzmTransfer({ lossDb, phaseDeg: i * 5 }));
    find('[data-mzm-transfer]').setAttribute('d', path(curve.map(t => t.PA)));
    find('[data-mzm-port-b]').setAttribute('d', path(curve.map(t => t.PB)));
    find('[data-mzm-waveform]').setAttribute('d', path([...rf.waveform, rf.waveform[0]]));
    find('[data-mzm-marker]').setAttribute('cx', 38 + biasDeg / 360 * 414);
    find('[data-mzm-marker]').setAttribute('cy', 139 - dc.PA * 116);
    const swing = 180 * rfRatio, lo = biasDeg - swing, hi = biasDeg + swing;
    const bands = [[Math.max(0,lo),Math.min(360,hi)],lo < 0 ? [lo+360,360] : hi > 360 ? [0,hi-360] : [0,0]];
    bands.forEach(([a,b],i) => { const band=find(i ? '[data-mzm-band-wrap]' : '[data-mzm-band]'); band.setAttribute('x',38+a/360*414);band.setAttribute('width',(b-a)/360*414); });
    const slope = (mzmTransfer({lossDb, phaseDeg:biasDeg+.1}).PA - mzmTransfer({lossDb, phaseDeg:biasDeg-.1}).PA)/.2;
    const a=Math.max(0,biasDeg-15), b=Math.min(360,biasDeg+15);
    find('[data-mzm-slope]').setAttribute('d',`M${38+a/360*414} ${139-(dc.PA+slope*(a-biasDeg))*116}L${38+b/360*414} ${139-(dc.PA+slope*(b-biasDeg))*116}`);
    if (!compact) {
      const peak=Math.max(rf.h1,rf.h2,rf.h3,1e-12);
      for (const k of [1,2,3]) {
        const height=rf['h'+k] < 1e-6 ? 0 : rf['h'+k]/peak*100;
        const bar=find(`[data-mzm-harmonic="${k}"]`);bar.setAttribute('height',height);bar.setAttribute('y',125-height);
        find(`[data-mzm-amplitude="${k}"]`).textContent=rf['h'+k].toFixed(4);
      }
      root.querySelectorAll('[data-mzm-preset]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.mzmPreset)===biasDeg)));
    }
    set('loss-readout', lossDb.toFixed(2) + ' dB'); set('bias-readout', biasDeg + '°');
    if (!compact) set('rf-readout', rfRatio.toFixed(2));
    set('er', dc.erDb === Infinity ? '∞' : dc.erDb.toFixed(2));
    set('total', (dc.totalPower * 100).toFixed(2) + '%'); set('bias-ratio', rf.vBiasRatio.toFixed(3));
    for (const k of [1, 2, 3]) set('h' + k, rf['h' + k] < 1e-6 ? '< 10⁻⁶' : rf['h' + k].toFixed(4));
    set('insight', rf.h1 < 1e-6 ? '峰值 / 谷底：基频为零，二倍频主导；这是偶函数折叠，不是半波截断。'
      : rf.h2 < 1e-6 ? '正交点：偶次谐波消失，一阶项传递基频；有限调制深度下仍有三次失真。'
      : '偏离正交点后偶次失真出现。静态 ER 由臂间振幅不平衡决定，不随偏置点改变。');
  }
  let frame = null;
  const schedule = () => { if (frame === null) frame=requestAnimationFrame(()=>{frame=null;paint();}); };
  const onInput = event => {
    if (event.target.matches('[data-mzm-loss]')) lossDb = Number(event.target.value);
    if (event.target.matches('[data-mzm-bias]')) biasDeg = Number(event.target.value);
    if (event.target.matches('[data-mzm-rf]')) rfRatio = Number(event.target.value);
    schedule();
  };
  const onClick = event => { const button=event.target.closest('[data-mzm-preset]');if (!button) return; biasDeg=Number(button.dataset.mzmPreset);find('[data-mzm-bias]').value=biasDeg;schedule(); };
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput); paint();
  return () => { root.removeEventListener('input', onInput);root.removeEventListener('click',onClick);if(frame!==null)cancelAnimationFrame(frame); };
}
