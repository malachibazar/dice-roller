import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js'
import { SHAPES, faceValue } from './shapes.js'

const EPS = 1e-4
const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()

// ---------------------------------------------------------------------------
// Build the merged polygonal faces of a convex hull from a point cloud.
// Returns: { verts: Vector3[], faces: [ { indices: number[] } ] }
// ---------------------------------------------------------------------------
function buildPolyFaces(points) {
  const hull = new ConvexHull()
  hull.setFromPoints(points)
  if (hull.faces.length === 0) throw new Error('degenerate hull')

  // Unique rounded vertex index map
  const verts = []
  const key = (p) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`
  const index = new Map()
  const tri = [] // triangles as [a,b,c] index triples
  for (const f of hull.faces) {
    const vidx = []
    let he = f.edge
    for (let i = 0; i < 3; i++) {
      const p = he.head().point
      const k = key(p)
      let id = index.get(k)
      if (id === undefined) { id = verts.length; index.set(k, id); verts.push(p.clone()); }
      vidx.push(id)
      he = he.next
    }
    tri.push([vidx[0], vidx[1], vidx[2]])
  }

  // triangle normals
  const tNorm = tri.map(([a, b, c]) => {
    const n = new THREE.Vector3()
      .subVectors(verts[b], verts[a])
      .cross(new THREE.Vector3().subVectors(verts[c], verts[a]))
      .normalize()
    return n
  })

  // Edge -> triangles map (key = sorted "i_j")
  const edgeTri = new Map()
  const addE = (a, b, t) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`
    if (!edgeTri.has(k)) edgeTri.set(k, [])
    edgeTri.get(k).push(t)
  }
  tri.forEach(([a, b, c], t) => { addE(a, b, t); addE(b, c, t); addE(a, c, t) })

  // Merge coplanar triangles sharing edges into polygonal faces.
  const comp = new Int32Array(tri.length).fill(-1)
  let cid = 0
  for (let t = 0; t < tri.length; t++) {
    if (comp[t] !== -1) continue
    comp[t] = cid
    const stack = [t]
    while (stack.length) {
      const cur = stack.pop()
      const verts3 = tri[cur]
      // check the 3 edges
      const edges = [[verts3[0], verts3[1]], [verts3[1], verts3[2]], [verts3[0], verts3[2]]]
      for (const [a, b] of edges) {
        const k = a < b ? `${a}_${b}` : `${b}_${a}`
        for (const nbt of (edgeTri.get(k) || [])) {
          if (nbt === cur || comp[nbt] !== -1) continue
          if (tNorm[cur].dot(tNorm[nbt]) > 0.9995) {
            comp[nbt] = cid
            stack.push(nbt)
          }
        }
      }
    }
    cid++
  }

  // For each component, collect unique vertex indices, order them around the polygon.
  const faces = []
  for (let c = 0; c < cid; c++) {
    const set = new Set()
    for (let t = 0; t < tri.length; t++) if (comp[t] === c) tri[t].forEach(i => set.add(i))
    const ids = [...set]
    // sort by angle around centroid in face plane
    const ctr = new THREE.Vector3()
    ids.forEach(i => ctr.add(verts[i]))
    ctr.divideScalar(ids.length)
    let fi = 0; while (fi < tri.length && comp[fi] !== c) fi++
    const n = tNorm[fi].clone()
    // reference axis
    let u = new THREE.Vector3(1, 0, 0)
    if (Math.abs(n.dot(u)) > 0.9) u = new THREE.Vector3(0, 1, 0)
    u.cross(n).normalize()
    const vAxis = new THREE.Vector3().crossVectors(n, u).normalize()
    ids.sort((a, b) => {
      const aa = Math.atan2(vAxis.dot(new THREE.Vector3().subVectors(verts[a], ctr)), u.dot(new THREE.Vector3().subVectors(verts[a], ctr)))
      const bb = Math.atan2(vAxis.dot(new THREE.Vector3().subVectors(verts[b], ctr)), u.dot(new THREE.Vector3().subVectors(verts[b], ctr)))
      return aa - bb
    })
    // orient outward (CCW when viewed from outside)
    const ordered = ensureOutward(ids, verts, n)
    faces.push({ indices: ordered })
  }
  return { verts, faces }
}

function ensureOutward(ids, verts, n) {
  // recompute normal from current order; flip if not aligned with n
  const [a, b, c] = ids
  const computed = new THREE.Vector3()
    .subVectors(verts[b], verts[a])
    .cross(new THREE.Vector3().subVectors(verts[c], verts[a]))
    .normalize()
  if (computed.dot(n) < 0) ids.reverse()
  return ids
}

// ---------------------------------------------------------------------------
// Numbering: pair opposite faces; label list has opposites at index k & F-1-k.
// ---------------------------------------------------------------------------
function numberFaces(faces, verts, shape) {
  const F = faces.length
  // outward local normals + centroids
  faces.forEach(f => {
    const [a, b, c] = f.indices
    f.normal = new THREE.Vector3()
      .subVectors(verts[b], verts[a])
      .cross(new THREE.Vector3().subVectors(verts[c], verts[a]))
      .normalize()
    f.centroid = new THREE.Vector3()
    f.indices.forEach(i => f.centroid.add(verts[i]))
    f.centroid.divideScalar(f.indices.length)
  })

  // build label list
  let labels
  if (shape.labels) {
    labels = shape.labels.slice()
  } else {
    labels = Array.from({ length: F }, (_, k) => String(k + 1))
  }

  // pair opposite faces (scan ALL unpaired so none are left over)
  const paired = new Array(F).fill(false)
  const pairsOrder = []
  for (let i = 0; i < F; i++) {
    if (paired[i]) continue
    let best = -1, bestDot = 2
    for (let j = 0; j < F; j++) {
      if (j === i || paired[j]) continue
      const d = faces[i].normal.dot(faces[j].normal)
      if (d < bestDot) { bestDot = d; best = j }
    }
    if (best === -1) continue // safety; shouldn't happen for even F
    paired[i] = true; paired[best] = true
    pairsOrder.push([i, best])
  }

  // order pairs by centroid z (so labels land near top first)
  pairsOrder.sort((p, q) => faces[p[0]].centroid.z - faces[q[0]].centroid.z)

  // assign labels[k] / labels[F-1-k]: prefer higher-z normal for the low label
  for (let p = 0; p < pairsOrder.length; p++) {
    const [a, b] = pairsOrder[p]
    const top = faces[a].normal.z >= faces[b].normal.z ? a : b
    const bot = top === a ? b : a
    faces[top].labelIndex = p
    faces[bot].labelIndex = F - 1 - p
    faces[top].label = labels[p]
    faces[bot].label = labels[F - 1 - p]
  }
}

// ---------------------------------------------------------------------------
// Face texture: solid base color with centered number.
// ---------------------------------------------------------------------------
function faceTexture(label, baseHex, inkHex) {
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')
  ctx.fillStyle = baseHex
  ctx.fillRect(0, 0, s, s)
  // subtle inner ring for depth (flat, no gradient)
  ctx.strokeStyle = inkHex
  ctx.globalAlpha = 0.10
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s * 0.40, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1
  // number
  ctx.fillStyle = inkHex
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const fs = label.length > 2 ? 96 : 128
  ctx.font = `700 ${fs}px ${getFont()}`
  ctx.fillText(label, s / 2, s / 2 + 6)
  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

function getFont() {
  return `"Söhne", ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`
}

// ---------------------------------------------------------------------------
// Public: build a die.
// ---------------------------------------------------------------------------
export function buildDie(sides, baseHex = '#f4f1ea', inkHex = '#1a1a1f') {
  const shape = SHAPES[sides]
  if (!shape) throw new Error('unknown die ' + sides)

  // raw points, normalised to max radius = 1
  const raw = shape.verts.map(v => new THREE.Vector3(v[0], v[1], v[2]))
  const maxR = Math.max(...raw.map(p => p.length()))
  const points = raw.map(p => p.clone().multiplyScalar(1 / maxR))

  const { verts, faces } = buildPolyFaces(points)
  numberFaces(faces, verts, shape)

  // -- geometry: triangulate each polygon via fan, UV-map in its own plane --
  const positions = [], uvs = [], groups = []
  const materials = faces.map(f => new THREE.MeshStandardMaterial({
    map: faceTexture(f.label, baseHex, inkHex),
    roughness: 0.42, metalness: 0.06, flatShading: false
  }))

  faces.forEach((f, fi) => {
    const start = positions.length / 3
    const n = f.normal
    const ctr = f.centroid
    // in-plane axes
    let u = new THREE.Vector3(1, 0, 0)
    if (Math.abs(n.dot(u)) > 0.9) u = new THREE.Vector3(0, 1, 0)
    u.cross(n).normalize()
    const vAxis = new THREE.Vector3().crossVectors(n, u).normalize()
    // extents around centroid for uniform UV scaling
    let maxExt = 1e-4
    f.indices.forEach(i => {
      const d = new THREE.Vector3().subVectors(verts[i], ctr)
      maxExt = Math.max(maxExt, Math.abs(u.dot(d)), Math.abs(vAxis.dot(d)))
    })
    // fan triangulation from vertex 0
    const idx = f.indices
    for (let k = 1; k < idx.length - 1; k++) {
      const tri = [idx[0], idx[k], idx[k + 1]]
      tri.forEach(i => {
        const d = new THREE.Vector3().subVectors(verts[i], ctr)
        const uu = 0.5 + u.dot(d) / (2 * maxExt)
        const vv = 0.5 + vAxis.dot(d) / (2 * maxExt)
        // flip V for standard texture orientation
        uvs.push(uu, 1 - vv)
        positions.push(verts[i].x, verts[i].y, verts[i].z)
      })
    }
    groups.push({ start, count: ((idx.length - 2) * 3), mat: fi })
  })

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  groups.forEach((g, i) => geo.addGroup(g.start, g.count, i))
  geo.computeVertexNormals()

  const mesh = new THREE.Mesh(geo, materials)
  mesh.castShadow = true
  mesh.receiveShadow = true

  // crisp edge overlay for a premium finish
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 1),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 })
  )
  mesh.add(edges)

  // -- cannon body: ConvexPolyhedron from polygon faces --
  const cv = verts.map(v => new CANNON.Vec3(v.x, v.y, v.z))
  const cf = faces.map(f => f.indices.slice())
  const poly = new CANNON.ConvexPolyhedron({ vertices: cv, faces: cf, radius: 0.02 })
  const body = new CANNON.Body({
    mass: 1,
    shape: poly,
    material: new CANNON.Material('die'),
    linearDamping: 0.12,
    angularDamping: 0.12,
    allowSleep: true,
    sleepSpeedLimit: 0.15,
    sleepTimeLimit: 0.4
  })

  return { mesh, body, faces, shape, baseHex, inkHex }
}

// Read the up-face value once the die is settled.
export function readDie(die) {
  const q = die.body.quaternion
  _q.set(q.x, q.y, q.z, q.w)
  let best = -1, bestY = -2
  die.faces.forEach((f, i) => {
    _v.copy(f.normal).applyQuaternion(_q)
    if (_v.y > bestY) { bestY = _v.y; best = i }
  })
  const f = die.faces[best]
  return { label: f.label, value: faceValue(die.shape, f.labelIndex) }
}