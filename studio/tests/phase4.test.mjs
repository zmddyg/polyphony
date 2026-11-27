import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFormulaHtml } from '../dist/core/formula-text.mjs';
import { fresnelNormal, thermalPhase } from '../dist/core/physics-contracts.mjs';
import { buildSciencePacket } from '../dist/core/teaching-science.mjs';
import { renderRcDualCharts } from '../dist/views/material-science.mjs';
test('physics prose becomes semantic subscripts while authored HTML remains escaped',()=>{
 const html=formatFormulaHtml('V_C R_L C_tot V_RF V_π V_bias f_-3dB t_r P_in V_cc <img onerror=bad>');
 for(const key of ['C','L','tot','RF','π','bias','-3dB','r','in','cc'])assert.ok(html.includes(`<sub>${key}</sub>`),key);
 assert.doesNotMatch(html,/<img|onerror="/);assert.match(html,/&lt;img/);
});
test('normal-incidence lossless Fresnel calculation conserves power and rejects invalid material values',()=>{
 const p=fresnelNormal(1,1.5);assert.ok(Math.abs(p.R-.04)<1e-12);assert.equal(p.R+p.T,1);
 assert.throws(()=>fresnelNormal(0,1.5));
});
test('thermal pi power uses SI parameters and is explicit about the assumed lumped model',()=>{
 const p=thermalPhase({wavelengthM:1550e-9,lengthM:500e-6,dnDT:1.86e-4,thermalResistanceKW:378.8,powerW:.022});
 assert.ok(Math.abs(p.pPiW-.022)<.00001);assert.ok(Math.abs(p.phaseRad-Math.PI)<.002);
 assert.throws(()=>thermalPhase({powerW:-1}));
});
test('RC audit renders both time-domain and voltage Bode vector charts from the same time constant',()=>{
 const p=buildSciencePacket({anchor:{id:'P4',title:'RC 原页'},parameters:{initialV:2}});
 const html=renderRcDualCharts(p);assert.equal((html.match(/<svg /g)??[]).length,2);
 assert.match(html,/时域充电/);assert.match(html,/波特图/);assert.match(html,/<sub>C<\/sub>/);
});
