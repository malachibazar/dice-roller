import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { buildDie, readDie } from './dice.js'
import { SHAPES, DICE_ORDER } from './shapes.js'

// ---------------------------------------------------------------------------
// DOM scaffold
// ---------------------------------------------------------------------------
const app = document.getElementById('app')
app.innerHTML = `
  <canvas id="scene"></canvas>
  <div class="shelf">
    <div class="brand">
      <span class="mark">DICE</span>
      <span class="sub">3D · TABLETOP</span>
    </div>
    <div class="controls">
      <div class="field">
        <span class="lbl">Sides</span>
        <div class="seg" id="sides"></div>
      </div>
      <div class="field">
        <span class="lbl">Count</span>
        <div class="stepper" id="count">
          <button data-d="-1" aria-label="fewer">−</button>
          <span class="val">2</span>
          <button data-d="1" aria-label="more">+</button>
        </div>
      </div>
      <button class="roll" id="roll">Roll</button>
    </div>
  </div>
  <div class="dock">
    <div class="total">
      <span class="lbl">Total</span>
      <span class="num">—</span>
    </div>
    <div class="breakdown" id="breakdown"></div>
  </div>
  <div class="hint">Space to roll</div>
`

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let sidesSel = 20
let countSel = 2
const MAX_DICE = 12
const dice = [] // {mesh, body, faces, shape, ...}
let rolling = false
let rollStart = 0
const BASE = '#f4f1ea'
const INK = '#1a1a1f'

// ---------------------------------------------------------------------------
// Renderer / Scene / Camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0a0a0b)
scene.fog = new THREE.Fog(0x0a0a0b, 26, 60)

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200)

// camera rig: azimuth + polar, looking at origin
const rig = { dist: 17, az: 0.22, polar: 1.02 } // radians
function updateCamera() {
  const d = rig.dist
  const sp = Math.sin(rig.polar), cp = Math.cos(rig.polar)
  camera.position.set(d * sp * Math.sin(rig.az), d * cp, d * sp * Math.cos(rig.az))
  camera.lookAt(0, 0.2, 0)
}
updateCamera()

// Lights: clean key + soft fill. No coloured gradients.
const hemi = new THREE.HemisphereLight(0xf5f3ee, 0x0a0a0b, 0.55)
scene.add(hemi)
const key = new THREE.DirectionalLight(0xfff7ea, 2.1)
key.position.set(6, 14, 8)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.camera.left = -14
key.shadow.camera.right = 14
key.shadow.camera.top = 14
key.shadow.camera.bottom = -14
key.shadow.camera.near = 1
key.shadow.camera.far = 50
key.shadow.bias = -0.0004
key.shadow.radius = 6
scene.add(key)
const fill = new THREE.DirectionalLight(0x6f7fa6, 0.5)
fill.position.set(-9, 6, -6)
scene.add(fill)

// Floor + subtle grid (flat colour, no gradient).
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(40, 96),
  new THREE.MeshStandardMaterial({ color: 0x121215, roughness: 0.95, metalness: 0.0 })
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

const grid = new THREE.GridHelper(40, 40, 0x232329, 0x181820)
grid.material.transparent = true
grid.material.opacity = 0.35
grid.position.y = 0.001
scene.add(grid)

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) })
world.broadphase = new CANNON.SAPBroadphase(world)
world.allowSleep = true
world.defaultContactMaterial.contactEquationStiffness = 1e7
world.defaultContactMaterial.contactEquationRelaxation = 3

const floorMat = new CANNON.Material('floor')
const dieMat = new CANNON.Material('die')
const wallMat = new CANNON.Material('wall')

world.addContactMaterial(new CANNON.ContactMaterial(floorMat, dieMat, { friction: 0.45, restitution: 0.28 }))
world.addContactMaterial(new CANNON.ContactMaterial(wallMat, dieMat, { friction: 0.2, restitution: 0.55 }))
world.addContactMaterial(new CANNON.ContactMaterial(dieMat, dieMat, { friction: 0.25, restitution: 0.3 }))

const floorBody = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Plane() })
floorBody.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(0, 1, 0))
world.addBody(floorBody)

// Screen-edge walls (vertical planes) computed from the camera frustum @ y=0.
const wallBodies = []
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const ray = new THREE.Raycaster()
const cornerNDC = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

function groundCorner(nx, ny) {
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera)
  const hit = new THREE.Vector3()
  ray.ray.intersectPlane(groundPlane, hit)
  return hit
}

function buildWalls() {
  // remove old
  for (const b of wallBodies) { world.removeBody(b) }
  wallBodies.length = 0

  const pts = cornerNDC.map(([x, y]) => groundCorner(x, y))
  if (pts.some(p => !p)) return
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4]
    // edge direction (along screen edge on ground): b - a
    const dir = new THREE.Vector3().subVectors(b, a).normalize()
    // inward normal (toward centroid)
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
    const ctr = new THREE.Vector3(0, 0, 0)
    let inward = new THREE.Vector3().subVectors(ctr, mid)
    inward.y = 0
    // normal perpendicular to edge dir, in ground plane, pointing inward
    const nrm = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir)
    if (nrm.dot(inward) < 0) nrm.negate()
    nrm.normalize()

    const body = new CANNON.Body({ mass: 0, material: wallMat, shape: new CANNON.Plane() })
    const q = new CANNON.Quaternion()
    q.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(nrm.x, nrm.y, nrm.z))
    body.quaternion.copy(q)
    body.position.set(a.x, 0, a.z)
    world.addBody(body)
    wallBodies.push(body)
  }
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  buildWalls()
}
window.addEventListener('resize', resize)
resize()

// ---------------------------------------------------------------------------
// Rolling
// ---------------------------------------------------------------------------
function clearDice() {
  for (const d of dice) {
    scene.remove(d.mesh)
    d.mesh.geometry.dispose()
    d.mesh.material.forEach(m => { m.map?.dispose?.(); m.dispose() })
    world.removeBody(d.body)
  }
  dice.length = 0
}

let resultFinalized = true

function rollDice() {
  if (rolling) return
  clearDice()

  // spread the spawn slightly across the top so dice tumble inward
  for (let i = 0; i < countSel; i++) {
    const die = buildDie(sidesSel, BASE, INK)
    const px = (Math.random() - 0.5) * 5
    const pz = (Math.random() - 0.5) * 5 - 1.0
    die.body.position.set(px, 7 + Math.random() * 2.5, pz)
    die.body.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6)
    die.body.angularVelocity.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14)
    die.body.velocity.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)
    die.body.wakeUp()
    world.addBody(die.body)
    scene.add(die.mesh)
    dice.push(die)
  }

  rolling = true
  rollStart = performance.now()
  resultFinalized = false
  setTotal(null)
  setBreakdown([])
  rollBtn.disabled = true
}

function finalizeResults() {
  const results = dice.map(readDie)
  const total = results.reduce((s, r) => s + r.value, 0)
  setTotal(total)
  setBreakdown(results, dice)
  rolling = false
  resultFinalized = true
  rollBtn.disabled = false
}

function isSettled() {
  if (performance.now() - rollStart < 1400) return false
  for (const d of dice) {
    if (d.body.sleepState !== CANNON.Body.SLEEPING) {
      const av = d.body.angularVelocity.length()
      const lv = d.body.velocity.length()
      if (av > 0.18 || lv > 0.12) return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
const sidesEl = document.getElementById('sides')
DICE_ORDER.forEach(s => {
  const b = document.createElement('button')
  b.textContent = SHAPES[s].label
  b.dataset.sides = s
  if (s === sidesSel) b.setAttribute('aria-pressed', 'true')
  b.addEventListener('click', () => {
    sidesSel = s
    ;[...sidesEl.children].forEach(c => c.removeAttribute('aria-pressed'))
    b.setAttribute('aria-pressed', 'true')
  })
  sidesEl.appendChild(b)
})

const countEl = document.getElementById('count')
const countVal = countEl.querySelector('.val')
countEl.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    countSel = Math.min(MAX_DICE, Math.max(1, countSel + Number(btn.dataset.d)))
    countVal.textContent = countSel
  })
})

const rollBtn = document.getElementById('roll')
rollBtn.addEventListener('click', rollDice)

const totalNum = document.querySelector('.total .num')
const breakdownEl = document.getElementById('breakdown')

function setTotal(v) {
  if (v === null) { totalNum.textContent = '—'; totalNum.classList.remove('pulse'); return }
  totalNum.textContent = String(v)
  totalNum.classList.remove('pulse')
  void totalNum.offsetWidth
  totalNum.classList.add('pulse')
}
function setBreakdown(results, dlist) {
  breakdownEl.innerHTML = ''
  if (!results.length) return
  results.forEach((r, i) => {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.innerHTML = `<span class="k">${dlist[i].shape.label}</span>${r.label}`
    breakdownEl.appendChild(chip)
  })
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); rollDice() }
})

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
window.__DBG = { get dice(){return dice}, world, rollDice, isSettled, get rolling(){return rolling}, readDie: (d)=> {
  // minimal inline read for debug
  return null
} }
const clock = new THREE.Clock()
const step = 1 / 60
let acc = 0

function loop() {
  requestAnimationFrame(loop)
  const dt = Math.min(clock.getDelta(), 0.05)
  acc += dt
  while (acc >= step) { world.step(step); acc -= step }
  for (const d of dice) {
    d.mesh.position.copy(d.body.position)
    d.mesh.quaternion.copy(d.body.quaternion)
  }
  if (rolling && !resultFinalized && isSettled()) finalizeResults()
  renderer.render(scene, camera)
}

// initial visual roll
loop()
rollDice()