import { ratio } from './contrast.mjs'
// Proposed system. Warm the neutrals (invite), keep ink (proven 19.67:1),
// fix ink-subtle, brighten the primary but keep it in the tenant-brandable --blue-* slot.
const T = {
  ink:'#0B0B0C', inkMuted:'#55555C', inkSubtle:'#696971', inkInverse:'#FFFFFF',
  canvas:'#FFFFFF', surface:'#FBFAF9', surfaceAlt:'#F5F3F1',   // warmed off cool grey
  line:'#E8E5E1', lineStrong:'#D6D2CD',
  // primary — brandable slot. Brighter and more saturated than #2E73B5.
  blue900:'#10305A', blue700:'#1B5AA0', blue500:'#1E74C8', blue300:'#5794CC', blue100:'#E3F0FC', blue50:'#F3F9FE',
  gold700:'#8A6C1F', gold600:'#A8842C', gold500:'#C9A227', gold300:'#E2C766', gold100:'#FBF5E3',
  rose700:'#962F5C', rose500:'#C75285', rose100:'#FCEEF5',
  violet700:'#5B21B6', violet500:'#7C3AED', violet100:'#EFE9FD',
  coral700:'#9A3412', coral500:'#EA580C', coral100:'#FFE8E0',
  success:'#2F6B4F', successSoft:'#EEF5F1', warn:'#8A6108', warnSoft:'#FDF4E5', danger:'#A32E2E', dangerSoft:'#FBEFEF', field:'#8A8A92',
}
const surfaces = [['canvas',T.canvas],['surface',T.surface],['surface-alt',T.surfaceAlt],
  ['blue-50',T.blue50],['blue-100',T.blue100],['gold-100',T.gold100],['rose-100',T.rose100],
  ['violet-100',T.violet100],['coral-100',T.coral100]]
let fail=0
const p=(cond,txt)=>{ if(!cond) fail++; console.log((cond?'PASS ':'FAIL ')+txt) }
console.log('=== body text on every surface (>=4.5) ===')
for(const [n,bg] of surfaces){
  for(const [tn,fg] of [['ink',T.ink],['ink-muted',T.inkMuted],['ink-subtle',T.inkSubtle]]){
    const r=ratio(fg,bg); p(r>=4.5, `${tn} on ${n} = ${r.toFixed(2)}`)
  }
}
console.log('\n=== filled buttons (>=4.5) ===')
for(const [n,fg,bg] of [['white on blue-500',T.inkInverse,T.blue500],['white on blue-700',T.inkInverse,T.blue700],
  ['white on blue-900 (nav)',T.inkInverse,T.blue900],['black on gold-500',T.ink,T.gold500],['black on gold-300',T.ink,T.gold300],
  ['white on violet-500',T.inkInverse,T.violet500],['white on danger',T.inkInverse,T.danger]]){
  const r=ratio(fg,bg); p(r>=4.5, `${n} = ${r.toFixed(2)}`)
}
console.log('\n=== coloured label on own tint (>=4.5) ===')
for(const [n,fg,bg] of [['blue-900/blue-100',T.blue900,T.blue100],['gold-700/gold-100',T.gold700,T.gold100],
  ['rose-700/rose-100',T.rose700,T.rose100],['violet-700/violet-100',T.violet700,T.violet100],
  ['coral-700/coral-100',T.coral700,T.coral100],['success/soft',T.success,T.successSoft],
  ['warn/soft',T.warn,T.warnSoft],['danger/soft',T.danger,T.dangerSoft]]){
  const r=ratio(fg,bg); p(r>=4.5, `${n} = ${r.toFixed(2)}`)
}
console.log('\n=== UI / borders / focus ring (>=3) ===')
for(const [n,fg,bg] of [['blue-500 focus ring on canvas',T.blue500,T.canvas],['gold-600 on canvas',T.gold600,T.canvas],
  ['rose-500 on canvas',T.rose500,T.canvas],['violet-500 on canvas',T.violet500,T.canvas],
  ['coral-500 on canvas',T.coral500,T.canvas],['FIELD border on canvas (WCAG 1.4.11)',T.field,T.canvas],['FIELD border on surface',T.field,T.surface],['FIELD border on surface-alt',T.field,T.surfaceAlt]]){
  const r=ratio(fg,bg); p(r>=3, `${n} = ${r.toFixed(2)}`)
}
console.log(`\n${fail===0?'ALL PASS':fail+' FAILURES'}`)

console.log('\n=== ladder rule: rung 300 must clear AA_UI 3:1 on white (contrast.ts:184) ===')
{ const r=ratio(T.blue300,'#FFFFFF'); p(r>=3, `blue-300 on white = ${r.toFixed(2)}`) }
console.log(`\nFINAL: ${fail===0?'ALL PAIRINGS PASS':fail+' FAILURES REMAIN'}`)
