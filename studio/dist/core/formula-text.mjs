// Escape untrusted text first. Only attribute-free semantic math tags survive.
export function formulaHtml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/&lt;(\/?)(sub|sup)&gt;/g, '<$1$2>');
}
export function formulaPlain(value = '') { return String(value).replace(/<\/?(?:sub|sup)>/g, ''); }

// Text stays escaped; only known physics notation becomes semantic subscripts.
export function formatFormulaHtml(value = '') {
  return formulaHtml(value)
    .replace(/\b(V|R|C|f|t|P|T|n|r)_(RF|bias|cc|tot|in|out|eff|ER|L|C|A|B|π|0|1|2|r|[-−]3dB)\b/gu, '$1<sub>$2</sub>')
    .replace(/V_π/gu, 'V<sub>π</sub>')
    .replace(/Vᵣꜰ|Vᵣf/gu, 'V<sub>RF</sub>')
    .replace(/Cₜₒₜ/gu, 'C<sub>tot</sub>').replace(/Rₗ/gu, 'R<sub>L</sub>')
    .replace(/V꜀/gu, 'V<sub>C</sub>').replace(/V₀/gu, 'V<sub>0</sub>')
    .replace(/Vπ/gu, 'V<sub>π</sub>').replace(/φ₀/gu, 'φ<sub>0</sub>');
}
