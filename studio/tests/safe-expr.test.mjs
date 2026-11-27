import test from 'node:test';
import assert from 'node:assert/strict';
import { compileExpression as compile, sampleDeclarativeCurve as sample } from '../dist/core/safe-expr.mjs';
const value=(expr,vars={})=>compile(expr,Object.keys(vars)).evaluate(vars);
test('arithmetic, precedence, signed exponents and right-associative power',()=>{
  for(const [expr,expected] of [['2+3*4',14],['(2+3)*4',20],['2^3^2',512],['-2^2',-4],['(-2)^2',4],['2^-2',.25],['--3+ +2',5],['1e-3+.5',.501],['8/2/2',2]])assert.equal(value(expr),expected,expr);
  assert.equal(value('a*x^2+b',{a:2,x:3,b:4}),22);
  assert.deepEqual(compile('x+x+y',['x','y','z']).variablesUsed,['x','y']);
});
test('all whitelisted functions and constants are accurate',()=>{
  const entries=[['sin(pi/2)',1],['cos(PI)',-1],['tan(0)',0],['asin(1)',Math.PI/2],['acos(1)',0],['atan(1)',Math.PI/4],['exp(1)',Math.E],['ln(e)',1],['log(E)',1],['log10(100)',2],['sqrt(9)',3],['abs(-4)',4],['min(3,2,9)',2],['max(3,2,9)',9],['sinc(0)',1],['sinc(1)',0]];
  for(const [expr,expected] of entries)assert.ok(Math.abs(value(expr)-expected)<1e-12,expr);
});
test('malformed syntax, unknown variables, excessive length and injection are rejected',()=>{
  for(const expr of ['', ' ', '2**3','1+','(1+2','1 2','sin()','sin(1,2)','min()','x.y','x[0]','constructor','__proto__','Math.sin(0)','globalThis','process.exit()','1;alert(1)','(()=>1)()','sqrt.constructor(1)','"test"','1=2','a?1:2','Infinity','NaN','foo(2)','1e999','x+'.repeat(121)])assert.throws(()=>compile(expr,['x']),undefined,expr);
  assert.throws(()=>compile('x',['constructor']));
  assert.throws(()=>compile('x',['sin']));
  assert.throws(()=>compile('x',['x']).evaluate(Object.create({x:1})),/变量/);
  assert.throws(()=>compile('x',['x']).evaluate({x:'1'}));
});
test('finite curve sampling validates ranges, variables, parameters and count',()=>{
  const points=sample({expr:'a*x^2',xMin:-1,xMax:1,params:{a:2}});
  assert.equal(points.length,96);assert.deepEqual(points[0],{x:-1,y:2});assert.deepEqual(points.at(-1),{x:1,y:2});
  assert.throws(()=>sample({expr:'sqrt(x)',xMin:-1,xMax:1}),/有限/);
  assert.throws(()=>sample({expr:'1/(x-1)',xMin:0,xMax:1}));
  assert.throws(()=>sample({expr:'z',xVar:'x'}),/未知/);
  for(const [xMin,xMax] of [[1,1],[2,1],[0,Infinity]])assert.throws(()=>sample({expr:'x',xMin,xMax}));
  for(const samples of [0,1,3.5,Infinity,2049])assert.throws(()=>sample({expr:'x',samples}));
  assert.throws(()=>sample({expr:'x',params:{a:NaN}}));
});
