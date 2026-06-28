// Headless physics test: build a die, drop it onto the floor, step the world,
// and confirm it falls, contacts the floor, and settles to a valid value.
import * as CANNON from 'cannon-es'
import { buildDie, readDie } from '../src/dice.js'

// DOM canvas stub (buildDie builds textures)
function fakeCtx(){ const n=()=>{}; return new Proxy({canvas:{width:256,height:256}},{get(t,p){return p in t?t[p]:n},set(t,p,v){t[p]=v;return true}}) }
global.document = { createElement: (t)=> t==='canvas' ? {width:256,height:256,getContext:()=>fakeCtx(),addEventListener:()=>{}} : {} }

const world = new CANNON.World({ gravity: new CANNON.Vec3(0,-22,0) })
world.broadphase = new CANNON.SAPBroadphase(world)
world.allowSleep = true
const floorMat = new CANNON.Material('f'), dieMat = new CANNON.Material('d')
world.addContactMaterial(new CANNON.ContactMaterial(floorMat, dieMat, { friction:0.4, restitution:0.3 }))
const floor = new CANNON.Body({ mass:0, material: floorMat, shape: new CANNON.Plane() })
floor.quaternion.setFromVectors(new CANNON.Vec3(0,0,1), new CANNON.Vec3(0,1,0))
world.addBody(floor)

let fails = 0
const ok=(c,m)=>{ if(!c){fails++;console.error('  ✗',m)}else console.log('  ✓',m) }

for (const sides of [4,6,8,10,12,20,100]) {
  console.log(`drop d${sides}`)
  const die = buildDie(sides)
  die.body.position.set(0, 6, 0)
  die.body.quaternion.setFromEuler(Math.random()*5,Math.random()*5,Math.random()*5)
  die.body.angularVelocity.set(Math.random()*6,Math.random()*6,Math.random()*6)
  world.addBody(die.body)

  let threw = null
  let y0 = die.body.position.y
  try {
    for (let i=0;i<600;i++) world.step(1/60)   // 10s sim
  } catch(e){ threw = e }

  ok(threw===null, `steps without throwing${threw?': '+threw.message:''}`)
  ok(die.body.position.y < y0, `fell from ${y0.toFixed(2)} to ${die.body.position.y.toFixed(2)}`)
  ok(die.body.position.y < 1.5, `rested near floor (y=${die.body.position.y.toFixed(2)})`)

  const r = readDie(die)
  ok(r.value >= 1 && r.value <= (sides===100?100:sides), `read value ${r.label} = ${r.value} in range`)

  world.removeBody(die.body)
}

console.log(`\n${fails===0?'PHYSICS ALL PASS':fails+' FAILURES'}`)
process.exit(fails?1:0)