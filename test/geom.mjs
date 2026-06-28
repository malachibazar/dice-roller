// Headless test for dice geometry + numbering + detection.
import { buildDie, readDie } from '../src/dice.js'
import { SHAPES, DICE_ORDER } from '../src/shapes.js'
import * as THREE from 'three'

// --- minimal DOM canvass stub ---
function fakeCtx() {
  const noop = () => {}
  return new Proxy({
    canvas: { width: 256, height: 256 },
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1,
    textAlign: '', textBaseline: '', font: '',
    fillRect: noop, clearRect: noop, beginPath: noop, arc: noop,
    stroke: noop, fill: noop, fillText: noop, save: noop, restore: noop, translate: noop, rotate: noop, scale: noop
  }, { get(t,p){ return p in t ? t[p] : noop }, set(t,p,v){ t[p]=v; return true } })
}
global.document = { createElement: (t) => {
  if (t === 'canvas') return { width: 256, height: 256, getContext: () => fakeCtx(), addEventListener: () => {} }
  return {}
} }

const expectedFaces = { 4:4, 6:6, 8:8, 10:10, 12:12, 20:20, 100:10 }
let fails = 0
const ok = (c,m) => { if(!c){fails++; console.error('  ✗', m)} else console.log('  ✓', m) }

for (const sides of DICE_ORDER) {
  console.log(`\n=== ${SHAPES[sides].label} (sides=${sides}) ===`)
  const die = buildDie(sides)
  const F = die.faces.length
  ok(F === expectedFaces[sides], `face count ${F} == ${expectedFaces[sides]}`)

  // labels collected
  const labels = die.faces.map(f => f.label).sort()
  console.log('   labels:', labels.join(' '))

  // opposite pairing: for each face find anti-parallel face, verify label sums.
  // The tetrahedron has no parallel opposite pairs, so skip d4.
  const shape = SHAPES[sides]
  if (sides !== 4) {
    for (let i = 0; i < F; i++) {
      let best = -1, bd = 2
      for (let j = 0; j < F; j++) if (j !== i) {
        const d = die.faces[i].normal.dot(die.faces[j].normal)
        if (d < bd) { bd = d; best = j }
      }
      const opp = die.faces[best]
      const a = parseInt(die.faces[i].label, 10)
      const b = parseInt(opp.label, 10)
      const target = shape.labels ? (sides === 100 ? 90 : 9) : (sides + 1)
      if (a + b !== target) { fails++; console.error(`  ✗ opposite sum ${die.faces[i].label}+${opp.label}=${a+b} expected ${target}`) }
    }
    ok(true, `opposite sums ok`)
  }

  // unique labels count == F
  ok(new Set(die.faces.map(f=>f.label)).size === F, `all ${F} labels unique`)

  // detection: align each face's normal to +Y and read it back
  const up = new THREE.Vector3(0, 1, 0)
  let detBad = 0
  for (let i = 0; i < F; i++) {
    const f = die.faces[i]
    const q = new THREE.Quaternion().setFromUnitVectors(f.normal, up)
    die.body.quaternion.set(q.x, q.y, q.z, q.w)
    die.body.quaternion.normalize ? null : null
    const r = readDie(die)
    if (r.label !== f.label) detBad++
  }
  ok(detBad === 0, `detection recovers each face's label (failures=${detBad})`)
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURES'}`)
process.exit(fails === 0 ? 0 : 1)

// ---- helpers (tiny THREE-independent quaternion) ----
function THREEx(){}
function vec(x,y,z){return {x,y,z}}
function vsub(a,b){return {x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}}
function vadd(a,b){return {x:a.x+b.x,y:a.y+b.y,z:a.z+b.z}}
function vscale(a,s){return {x:a.x*s,y:a.y*s,z:a.z*s}}
function vnorm(a){const m=Math.hypot(a.x,a.y,a.z)||1;return {x:a.x/m,y:a.y/m,z:a.z/m}}
function vdot(a,b){return a.x*b.x+a.y*b.y+a.z*b.z}
function vcross(a,b){return {x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x}}

function THREElikeY(){ return {x:0,y:1,z:0} }

function quatFromTo(from, to) {
  // shortest rotation taking from -> to (THREE.Quaternion.setFromVectors semantics)
  let r = vnorm({x:from.x,y:from.y,z:from.z})
  let t = vnorm({x:to.x,y:to.y,z:to.z})
  let d = vdot(r, t)
  if (d < -0.999999) {
    // 180: pick orthogonal axis
    let ortho = Math.abs(r.x) < 0.9 ? {x:1,y:0,z:0} : {x:0,y:1,z:0}
    let axis = vnorm(vcross(r, ortho))
    const s = Math.sqrt(0.5), c = Math.sqrt(0.5)
    return { x: axis.x*s, y: axis.y*s, z: axis.z*s, w: c }
  }
  let c = vcross(r, t)
  const w = Math.sqrt((1 + d)) * 0.5  // NOTE: not normalised; THREE does it
  const q = { x: c.x, y: c.y, z: c.z, w }
  // normalise
  const m = Math.hypot(q.x,q.y,q.z,q.w) || 1
  q.x/=m;q.y/=m;q.z/=m;q.w/=m
  return q
}

function faceValueValues(label, shape) {
  if (shape.labels) {
    const raw = parseInt(label, 10)
    return shape.label === 'd100' ? (raw === 0 ? 100 : raw) : (raw === 0 ? 10 : raw)
  }
  return parseInt(label, 10)
}