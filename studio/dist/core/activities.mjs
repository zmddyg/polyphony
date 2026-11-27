import { compileExpression, sampleDeclarativeCurve } from './safe-expr.mjs';
const universal = [
  { id:'concept-diagnosis@1',title:'双轮概念迷思与伪掌握对撞',category:'概念诊断',bestFor:'易混淆概念、同选异因的伪掌握识别',scene:'choice',input:'choice-reason',reveal:'conflict-wall' },
  { id:'step-fault@1',title:'推导 / 代码 / 流程逐行找茬',category:'逻辑与代码审计',bestFor:'公式推导跳步、代码 Bug 定位、实验流程排错',scene:'step-fault',input:'step-reason',reveal:'line-heatmap' },
  { id:'param-explorer@1',title:'声明式公式参数沙盒与预测',category:'动态公式沙盒',bestFor:'解析表达式、参数灵敏度与极值折中',scene:'param-explorer',input:'prediction-reason',reveal:'declarative-svg' },
  { id:'evidence-weighing@1',title:'多维方案权衡与可质询 AI 辩友',category:'大班思辨与方案权衡',bestFor:'通识导论破冰、技术路线选型、开放式利弊权衡',scene:'evidence-weighing',input:'stance-reason',reveal:'ai-peer-challenge' },
];
const legacy = [
  { id:'choice@1',title:'概念迷思诊断',scene:'choice',input:'choice-reason',reveal:'choices' },
  { id:'mzi-phase@1',title:'MZM 传输与谐波示例',scene:'mzi',input:'phase-power',reveal:'two-port-power' },
  { id:'rc-degeneracy@1',title:'RC 参数排障示例',scene:'rc-fault',input:'choice-reason',reveal:'choices' },
  { id:'spectral-aliasing@1',title:'光谱采样示例',scene:'optical-aliasing',input:'choice-reason',reveal:'choices' },
];
export const MODULE_MANIFESTS=Object.freeze(universal.map(m=>Object.freeze({...m,aggregate:'response-counts',guardrails:['原页证据编号','双轮状态机',...(m.id==='param-explorer@1'?['白名单表达式','有限数值采样']:['契约与选项校验'])]})));
export const activities=Object.freeze([...MODULE_MANIFESTS,...legacy.map(m=>Object.freeze({...m,aggregate:m.id==='mzi-phase@1'?'phase-samples':'response-counts'}))]);
const oldIds={mzi:'mzi-phase@1','rc-fault':'rc-degeneracy@1','optical-aliasing':'spectral-aliasing@1'};
export function getActivity(lessonOrId) {
  let id=typeof lessonOrId==='string'?lessonOrId:lessonOrId?.activityId??oldIds[lessonOrId?.id]??'choice@1';
  id=oldIds[id]??id;
  if(['source-critique@1','number-blackbox@1'].includes(id))id='choice@1';
  return activities.find(m=>m.id===id);
}
const fail=message=>{throw Error('模块契约：'+message);};
const text=(v,name,max=2500)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(name+'须为非空文本，最多 '+max+' 字符');};
const list=(v,name,min,max)=>{if(!Array.isArray(v)||v.length<min||v.length>max)fail(name+'数量须为 '+min+'–'+max);};
const keys=(value,allowed,name)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail(name+' 包含未知字段或格式无效');};
export function validateModulePayload(activityId,c) {
  if(!getActivity(activityId))fail('未知 activityId');
  if(!MODULE_MANIFESTS.some(m=>m.id===activityId)&&c==null)return true;
  if(!c||typeof c!=='object'||Array.isArray(c))fail('缺少 moduleConfig');
  if(JSON.stringify(c).length>24000)fail('配置超过大小限制');
  const fields={'concept-diagnosis@1':[],'step-fault@1':['artifactTitle','artifactLang','steps','faultStepId','faultDiagnosis'],'param-explorer@1':['formulaDisplay','xAxis','yAxis','sliders','curves','insightNote'],'evidence-weighing@1':['dimensions','aiPeer']};
  keys(c,['quickReasons','takeaway',...(fields[activityId]??[])],'moduleConfig');
  list(c.quickReasons,'quickReasons',1,12);c.quickReasons.forEach(v=>text(v,'quickReasons',180));
  if(c.takeaway){keys(c.takeaway,['formula','summary','pitfall'],'takeaway');text(c.takeaway.summary,'takeaway.summary');text(c.takeaway.pitfall,'takeaway.pitfall');if(c.takeaway.formula!==undefined)text(c.takeaway.formula,'takeaway.formula');}
  if(activityId==='step-fault@1') {
    text(c.artifactTitle,'artifactTitle');if(!['math','code','flow'].includes(c.artifactLang))fail('artifactLang 须为 math / code / flow');
    list(c.steps,'steps',3,12);const ids=new Set(),lines=new Set();
    c.steps.forEach(s=>{keys(s,['id','line','content','tag'],'steps');text(s?.id,'steps.id',64);text(s.line,'steps.line',12);text(s.content,'steps.content');if(s.tag!==undefined)text(s.tag,'steps.tag',120);if(ids.has(s.id)||lines.has(s.line))fail('步骤编号或行号重复');ids.add(s.id);lines.add(s.line);});
    if(!ids.has(c.faultStepId))fail('faultStepId 不在 steps 中');text(c.faultDiagnosis,'faultDiagnosis');
  }
  if(activityId==='evidence-weighing@1') {
    list(c.dimensions,'dimensions',2,4);c.dimensions.forEach(v=>text(v,'dimensions',80));
    if(new Set(c.dimensions).size!==c.dimensions.length)fail('评价维度重复');
    keys(c.aiPeer,['persona','claim','flawHint'],'aiPeer');['persona','claim','flawHint'].forEach(k=>text(c.aiPeer?.[k],'aiPeer.'+k));
  }
  if(activityId==='param-explorer@1') {
    text(c.formulaDisplay,'formulaDisplay');text(c.insightNote,'insightNote');
    keys(c.xAxis,['symbol','label','min','max','unit'],'xAxis');keys(c.yAxis,['label','min','max','unit'],'yAxis');
    for(const axis of [c.xAxis,c.yAxis]){text(axis?.label,'axis.label',100);if(axis.unit!==undefined)text(axis.unit,'axis.unit',32);if(!Number.isFinite(axis.min)||!Number.isFinite(axis.max)||axis.min>=axis.max)fail('坐标范围须有限且 min < max');}
    text(c.xAxis.symbol,'xAxis.symbol',32);list(c.sliders,'sliders',1,3);list(c.curves,'curves',1,2);
    const symbols=new Set([c.xAxis.symbol]),params={};
    for(const s of c.sliders){
      keys(s,['symbol','label','min','max','step','defaultValue','unit'],'sliders');if(s.unit!==undefined)text(s.unit,'sliders.unit',32);
      text(s?.symbol,'sliders.symbol',32);text(s.label,'sliders.label',100);
      if(symbols.has(s.symbol))fail('横轴与参数的变量名称重复');symbols.add(s.symbol);
      if(![s.min,s.max,s.step,s.defaultValue].every(Number.isFinite)||s.min>=s.max||s.step<=0||s.step>s.max-s.min||s.defaultValue<s.min||s.defaultValue>s.max)fail('滑块范围、步长或默认值无效');
      params[s.symbol]=s.defaultValue;
    }
    for(const curve of c.curves){
      keys(curve,['label','expr','style'],'curves');
      text(curve?.label,'curves.label',120);if(curve.style!==undefined&&!['solid','dashed'].includes(curve.style))fail('曲线样式须为 solid / dashed');
      compileExpression(curve.expr,[...symbols]);
      const corners=Array.from({length:2**c.sliders.length},(_,mask)=>Object.fromEntries(c.sliders.map((s,i)=>[s.symbol,mask&1<<i?s.max:s.min])));
      for(const p of [params,...corners])sampleDeclarativeCurve({expr:curve.expr,xVar:c.xAxis.symbol,xMin:c.xAxis.min,xMax:c.xAxis.max,params:p});
    }
  }
  return true;
}
