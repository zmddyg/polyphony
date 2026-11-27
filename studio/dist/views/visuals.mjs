import { mzmTransfer } from '../core/optics.mjs';
let sceneIndex = 0;
const curve = (values, color) => `<path d="${values.map((v,i) => `${i?'L':'M'}${50+i/(values.length-1)*600} ${275-v*210}`).join(' ')}" fill="none" stroke="${color}" stroke-width="3"/>`;
export function sceneGraphic(lessonId, { hideExample = false } = {}) {
  const id = 'photonics-scene-' + ++sceneIndex;
  let body, title;
  if (lessonId === 'mzi') {
    title = '有损 MZM 双端传输特性';
    body = curve(Array.from({length:73},(_,i) => mzmTransfer({lossDb:3,phaseDeg:i*5}).PA),'#22D3EE') +
      curve(Array.from({length:73},(_,i) => mzmTransfer({lossDb:3,phaseDeg:i*5}).PB),'#34D399') +
      '<text x="50" y="46">单臂 α = 3 dB / 静态 ER ≈ 15.3 dB</text><text x="265" y="320">π 谷底：二次项倍频</text>';
  } else if (lessonId === 'rc-fault') {
    title = '高速光电探测前级时频简并';
    body = curve(Array.from({length:73},(_,i)=>1-Math.exp(-i/14.4)),'#22D3EE') +
      '<text x="50" y="45">20 kΩ × 100 pF = 10 kΩ × 200 pF</text><text x="290" y="250">τ = 2 μs / 79.58 kHz</text><text x="50" y="320">i(0⁺)：0.25 mA vs 0.50 mA</text>';
  } else if (lessonId === 'optical-aliasing') {
    title = '稀疏采样的单周期与二倍频竞争谱';
    body = [1,2].map((k,j)=>curve(Array.from({length:97},(_,i)=>(1+Math.cos(i/96*2*Math.PI*k))/2),j?'#34D399':'#22D3EE')).join('') +
      '<text x="50" y="45">三点训练 RMS = 0 / 独立盲测 θ</text><text x="50" y="320">0° / 120° / 240°：模型重合</text>';
  } else {
    title = '引文、预测与独立证据构成课堂探究';
    body = '<path d="M80 180H630M210 180l100-80h180M310 180l100 80h80" stroke="#22D3EE" stroke-width="4" fill="none"/><text x="80" y="110">原页引文</text><text x="310" y="60">竞争预测</text><text x="420" y="310">独立验证</text>';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="348" viewBox="0 0 720 348" class="poly-scene-graphic" role="img" aria-labelledby="${id}" style="display:block;width:100%;height:auto"><title id="${id}">${title}</title><g fill="#9FB4CC" font-family="PingFang SC,Noto Sans SC,Microsoft YaHei UI,system-ui,sans-serif" font-size="20">${body}</g></svg>`;
}
