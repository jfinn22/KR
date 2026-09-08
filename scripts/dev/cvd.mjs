// Viénot-Brettel-Mollon dichromat simulation + CIEDE2000-lite (CIE76 deltaE in Lab).
const h2r=h=>{const c=h.replace('#','');return [0,2,4].map(i=>parseInt(c.slice(i,i+2),16))}
const lin=v=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4}
const delin=v=>{const c=Math.max(0,Math.min(1,v));return 255*(c<=0.0031308?12.92*c:1.055*c**(1/2.4)-0.055)}
// sRGB -> LMS (Hunt-Pointer-Estevez via XYZ), Viénot 1999 matrices
const RGB2LMS=[[0.31399,0.63951,0.04649],[0.15537,0.75789,0.08670],[0.01775,0.10944,0.87247]]
const LMS2RGB=[[5.47221,-4.64196,0.16963],[-1.12524,2.29317,-0.16789],[0.02980,-0.19318,1.16364]]
const mul=(M,v)=>M.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2])
const SIM={
  deuteranopia:[[1,0,0],[0.49421,0,1.24827],[0,0,1]],
  protanopia:  [[0,2.02344,-2.52581],[0,1,0],[0,0,1]],
  tritanopia:  [[1,0,0],[0,1,0],[-0.395913,0.801109,0]],
}
function simulate(hex,type){
  const rgbL=h2r(hex).map(lin)
  const lms=mul(RGB2LMS,rgbL)
  const sim=mul(SIM[type],lms)
  return mul(LMS2RGB,sim).map(delin)
}
// sRGB(0-255, already gamma) -> Lab (D65)
function lab(rgb){
  const [r,g,b]=rgb.map(lin)
  let X=(0.4124*r+0.3576*g+0.1805*b)/0.95047
  let Y=(0.2126*r+0.7152*g+0.0722*b)/1.00000
  let Z=(0.0193*r+0.1192*g+0.9505*b)/1.08883
  const f=t=>t>0.008856?Math.cbrt(t):(7.787*t+16/116)
  ;[X,Y,Z]=[f(X),f(Y),f(Z)]
  return [116*Y-16, 500*(X-Y), 200*(Y-Z)]
}
const dE=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])
const HUES={indigo:'#4F46E5',violet:'#7C3AED',fuchsia:'#C026D3',rose:'#C75285',coral:'#EA580C',amber:'#A8842C',teal:'#0D9488',ocean:'#2E73B5'}
const names=Object.keys(HUES)
const THRESH=15 // dE below this = easily confusable at chip size
for(const type of ['normal','deuteranopia','protanopia','tritanopia']){
  const labs={}
  for(const n of names) labs[n]= type==='normal'? lab(h2r(HUES[n])) : lab(simulate(HUES[n],type))
  const clashes=[]
  let min=Infinity, minPair=''
  for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){
    const d=dE(labs[names[i]],labs[names[j]])
    if(d<min){min=d;minPair=names[i]+'/'+names[j]}
    if(d<THRESH)clashes.push(`${names[i]}/${names[j]} dE=${d.toFixed(1)}`)
  }
  console.log(`${type.padEnd(14)} closest pair ${minPair} dE=${min.toFixed(1)}  ${clashes.length?'CONFUSABLE: '+clashes.join(', '):'all pairs distinguishable'}`)
}

// ---- find the largest subset where EVERY pair clears dE>=THRESH in ALL vision types ----
function worstPairwise(subset){
  let worst=Infinity
  for(const type of ['normal','deuteranopia','protanopia','tritanopia']){
    const labs={}
    for(const n of subset) labs[n]= type==='normal'? lab(h2r(HUES[n])) : lab(simulate(HUES[n],type))
    for(let i=0;i<subset.length;i++)for(let j=i+1;j<subset.length;j++)
      worst=Math.min(worst,dE(labs[subset[i]],labs[subset[j]]))
  }
  return worst
}
let best=null
const combos=(arr,k)=>k===0?[[]]:arr.flatMap((v,i)=>combos(arr.slice(i+1),k-1).map(c=>[v,...c]))
for(let k=8;k>=3;k--){
  const all=combos(names,k).map(s=>({s,w:worstPairwise(s)})).sort((a,b)=>b.w-a.w)
  console.log(`k=${k}: best subset [${all[0].s.join(', ')}] worst dE=${all[0].w.toFixed(1)} ${all[0].w>=15?'<-- SAFE':''}`)
  if(all[0].w>=15 && !best) best=all[0]
}
console.log(`\nRECOMMENDED: ${best? best.s.length+' hues ['+best.s.join(', ')+'] worst-case dE '+best.w.toFixed(1)+' across normal + all three dichromacies' : 'none clear dE 15'}`)
