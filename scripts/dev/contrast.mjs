// Independent WCAG 2.1 contrast checker. Same maths as src/domain/branding/contrast.ts.
const hex2rgb = (h) => {
  const c = h.trim().replace(/^#/, '')
  const f = c.length === 3 ? c.split('').map(x => x + x).join('') : c
  return [parseInt(f.slice(0,2),16), parseInt(f.slice(2,4),16), parseInt(f.slice(4,6),16)]
}
const lin = (v) => { const c = v/255; return c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4 }
const lum = ([r,g,b]) => 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b)
export const ratio = (a,b) => {
  const [la,lb] = [lum(hex2rgb(a)), lum(hex2rgb(b))]
  const [hi,lo] = la > lb ? [la,lb] : [lb,la]
  return (hi+0.05)/(lo+0.05)
}
// pairs: [fg, bg, label, requirement]
export function check(pairs) {
  let fails = 0
  const rows = pairs.map(([fg,bg,label,req=4.5]) => {
    const r = ratio(fg,bg)
    const ok = r >= req
    if (!ok) fails++
    return `${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(6)}:1  (need ${req})  ${label}  ${fg} on ${bg}`
  })
  console.log(rows.join('\n'))
  console.log(`\n${pairs.length - fails}/${pairs.length} pass, ${fails} FAIL`)
  return fails
}
if (process.argv[2] === '--baseline') {
  console.log('=== EXISTING SHIPPED PALETTE ===')
  check([
    ['#0B0B0C','#FFFFFF','ink on canvas'],
    ['#55555C','#FFFFFF','ink-muted on canvas'],
    ['#77777F','#FFFFFF','ink-subtle on canvas'],
    ['#FFFFFF','#2E73B5','white on blue-500 (primary btn)'],
    ['#FFFFFF','#1A558D','white on blue-700 (hover)'],
    ['#FFFFFF','#133458','white on blue-900 (nav)'],
    ['#0B0B0C','#C9A227','black on gold-500 (gold btn)'],
    ['#0B0B0C','#E2C766','black on gold-300 (gold hover)'],
    ['#8A6C1F','#FBF5E3','gold-700 on gold-100'],
    ['#962F5C','#FCEEF5','rose-700 on rose-100'],
    ['#133458','#E2EEFA','blue-900 on blue-100 (secondary btn)'],
    ['#2F6B4F','#EEF5F1','success on success-soft'],
    ['#8A6108','#FDF4E5','warn on warn-soft'],
    ['#A32E2E','#FBEFEF','danger on danger-soft'],
    ['#C75285','#FFFFFF','rose-500 on canvas (UI 3:1)',3],
    ['#A8842C','#FFFFFF','gold-600 on canvas (UI 3:1)',3],
  ])
}
