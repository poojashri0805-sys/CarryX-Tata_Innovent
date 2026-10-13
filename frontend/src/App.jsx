
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import {
  Activity,
  AlertTriangle,
  Check,
  Clock,
  History,
  LayoutDashboard,
  MapPin,
  Play,
  RefreshCw,
  ShieldAlert,
  Square,
  Truck,
  Zap,
} from 'lucide-react'

import {
  getTrips,
  getPrediction,
  getTripZones,
  getSensorSummary,
  getSensorRecords,
} from './api'

const ZONE_LAYOUT = [
  { id: 1, name: 'FRONT LEFT' },
  { id: 2, name: 'FRONT RIGHT' },
  { id: 3, name: 'CENTER MASS', wide: true },
  { id: 4, name: 'REAR LEFT' },
  { id: 5, name: 'REAR RIGHT' },
]

const PHASE_ORDER = [
  'empty',
  'loading',
  'loaded',
  'unloading',
  'post_unload',
]

const PHASE_LABELS = {
  empty: 'Empty bed baseline',
  loading: 'Loading material',
  loaded: 'Truck loaded',
  unloading: 'Unloading material',
  post_unload: 'Post-unload inspection',
}

function Metric({ label, children, icon, tone = 'green' }) {
  return (
    <div className={`metric metric-${tone}`}>
      <div className="metric-top">
        <span>{label}</span>
        {icon}
      </div>
      <div className="metric-value">{children}</div>
    </div>
  )
}

function getPhase(record) {
  return String(record?.phase ?? '').toLowerCase().trim()
}

function formatNumber(value, digits = 1) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(digits) : '—'
}

function getRiskClass(level) {
  if (level === 'high') return 'zone-red'
  if (level === 'moderate') return 'zone-yellow'
  if (level === 'low') return 'zone-green'
  return 'zone-neutral'
}

const PHASE_STEP_INFO = {
  empty: {
    num: 1,
    title: 'EMPTY BED',
    subtitle: 'Baseline tare state · Clean empty bed',
    tag: 'Baseline Tare',
    icon: '⚪',
  },
  loading: {
    num: 2,
    title: 'LOADING MATERIAL',
    subtitle: 'Excavator loading rich earth & soil payload',
    tag: 'Soil Loading',
    icon: '⚡',
  },
  loaded: {
    num: 3,
    title: 'TRUCK LOADED',
    subtitle: 'Full haul soil payload in transit',
    tag: 'Haul En Route',
    icon: '📦',
  },
  unloading: {
    num: 4,
    title: 'UNLOADING MATERIAL',
    subtitle: 'Hydraulic bed elevation & soil discharge',
    tag: 'Discharge',
    icon: '🔽',
  },
  post_unload: {
    num: 5,
    title: 'POST-LOAD INSPECTION',
    subtitle: 'Bed inspection for carryback retention',
    tag: 'Carryback Inspection',
    icon: '🔍',
  },
}

function normalizePhase(phaseStr) {
  const p = String(phaseStr || '').toLowerCase().trim()
  if (p.includes('unloading')) return 'unloading'
  if (p.includes('post') || p.includes('inspect')) return 'post_unload'
  if (p.includes('loaded')) return 'loaded'
  if (p.includes('loading') || (p.includes('load') && p.includes('material'))) return 'loading'
  return 'empty'
}

function createSoilBedPayload() {
  const pivot = new THREE.Group()

  // Massive contoured soil heap filling the entire dump bed
  const moundWidth = 7.5
  const moundLength = 9.5
  const moundGeo = new THREE.PlaneGeometry(moundWidth, moundLength, 28, 32)
  moundGeo.rotateX(-Math.PI / 2)
  const pos = moundGeo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const nx = x / (moundWidth * 0.5)
    const nz = z / (moundLength * 0.5)
    const bellX = Math.max(0, 1 - nx * nx)
    const bellZ = Math.max(0, 1 - nz * nz)
    // High peaked soil heap in center (up to 3.5 units high above bed floor, bulging past sideboards)
    let h = 3.5 * Math.pow(bellX, 0.62) * Math.pow(bellZ, 0.70)
    // Organic soil terrain ripples, furrowed ridges, and natural loam crumbly texture
    h += Math.sin(x * 2.4 + z * 1.8) * 0.22 + Math.cos(x * 4.2 - z * 3.4) * 0.14
    h += Math.sin(z * 6.5) * 0.08
    pos.setY(i, Math.max(0.12, h))
  }
  moundGeo.computeVertexNormals()

  const soilMat = new THREE.MeshStandardMaterial({
    color: '#634125', // Rich dark loam / moist mining earth soil
    roughness: 0.96,
    metalness: 0.03,
  })

  const moundMesh = new THREE.Mesh(moundGeo, soilMat)
  moundMesh.castShadow = true
  moundMesh.receiveShadow = true
  pivot.add(moundMesh)

  // Enclosing bed cavity base so the heap looks fully packed from every angle
  const baseBox = new THREE.Mesh(
    new THREE.BoxGeometry(moundWidth * 0.96, 1.5, moundLength * 0.96),
    soilMat,
  )
  baseBox.position.set(0, -0.65, 0)
  pivot.add(baseBox)

  // Fine earth/soil clods scattered on the surface (crumbly granular soil texture, NO rocks!)
  const soilClods = []
  const clodGeo = new THREE.SphereGeometry(0.25, 8, 8)
  const clodMat = new THREE.MeshStandardMaterial({
    color: '#52341b',
    roughness: 0.98,
    metalness: 0.02,
  })

  // 24 small granular soil clods across the crown
  for (let i = 0; i < 24; i++) {
    const clod = new THREE.Mesh(clodGeo, clodMat)
    const cx = (Math.random() - 0.5) * 5.0
    const cz = (Math.random() - 0.5) * 7.0
    const nx = cx / (moundWidth * 0.5)
    const nz = cz / (moundLength * 0.5)
    const bellX = Math.max(0, 1 - nx * nx)
    const bellZ = Math.max(0, 1 - nz * nz)
    const cy = 3.3 * Math.pow(bellX, 0.65) * Math.pow(bellZ, 0.72)
    clod.position.set(cx, cy, cz)
    clod.scale.set(
      0.8 + Math.random() * 0.5,
      0.5 + Math.random() * 0.4,
      0.8 + Math.random() * 0.5,
    )
    clod.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    clod.castShadow = true
    clod.userData = {
      originPos: clod.position.clone(),
      originScale: clod.scale.clone(),
    }
    pivot.add(clod)
    soilClods.push(clod)
  }

  // Loading excavator particle stream (overhead falling dark soil and earth granules)
  const loadCount = 50
  const loadGeom = new THREE.BufferGeometry()
  const loadPos = new Float32Array(loadCount * 3)
  const loadColors = new Float32Array(loadCount * 3)
  const c1 = new THREE.Color('#785131')
  const c2 = new THREE.Color('#462d18')

  for (let i = 0; i < loadCount; i++) {
    loadPos[i * 3] = (Math.random() - 0.5) * 3.6
    loadPos[i * 3 + 1] = Math.random() * 5 + 3.8
    loadPos[i * 3 + 2] = (Math.random() - 0.5) * 4.5
    const mix = c1.clone().lerp(c2, Math.random())
    loadColors[i * 3] = mix.r
    loadColors[i * 3 + 1] = mix.g
    loadColors[i * 3 + 2] = mix.b
  }

  loadGeom.setAttribute('position', new THREE.BufferAttribute(loadPos, 3))
  loadGeom.setAttribute('color', new THREE.BufferAttribute(loadColors, 3))

  const loadMat = new THREE.PointsMaterial({
    size: 0.28,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
  })

  const loadingParticles = new THREE.Points(loadGeom, loadMat)
  loadingParticles.visible = false

  return {
    pivot,
    moundMesh,
    baseBox,
    soilClods,
    loadingParticles,
    loadPos,
    loadGeom,
    loadCount,
  }
}

function createRetainedCarrybackLayer() {
  const group = new THREE.Group()

  // Base mud layer sticking to the bottom floor of the dump bed
  const floorGeo = new THREE.PlaneGeometry(7.0, 9.0, 20, 24)
  floorGeo.rotateX(-Math.PI / 2)
  const fPos = floorGeo.attributes.position
  for (let i = 0; i < fPos.count; i++) {
    const x = fPos.getX(i)
    const z = fPos.getZ(i)
    // Sticky build-up is thickest in the front corners (Zone 1 FRONT LEFT, Zone 2 FRONT RIGHT)
    // and near headboard / side seams
    const frontFactor = Math.max(0, z / 4.5)
    const sideFactor = Math.abs(x) / 3.5
    const cornerBoost = frontFactor * sideFactor * 0.75
    const ripple = Math.sin(x * 3.5) * Math.cos(z * 3.0) * 0.08
    fPos.setY(i, 0.22 + frontFactor * 0.45 + cornerBoost + ripple)
  }
  floorGeo.computeVertexNormals()

  const stickyMat = new THREE.MeshStandardMaterial({
    color: '#462c18', // Dark wet compacted carryback mud
    roughness: 0.88,
    metalness: 0.04,
  })

  const floorMesh = new THREE.Mesh(floorGeo, stickyMat)
  floorMesh.receiveShadow = true
  group.add(floorMesh)

  // Stuck mud clumps in front corners and headboard crevices (classic carryback hotspots)
  const clumpGeo = new THREE.SphereGeometry(0.35, 10, 10)
  const mudClumps = [
    [-2.6, 0.55, 3.8, 1.4], // Front Left (Zone 1)
    [2.6, 0.55, 3.8, 1.4],  // Front Right (Zone 2)
    [-2.8, 0.45, 1.5, 1.1], // Mid Left wall
    [2.8, 0.45, 1.5, 1.1],  // Mid Right wall
    [0.0, 0.5, 4.0, 1.3],   // Front headboard center
    [-1.5, 0.35, -2.5, 0.9],// Rear Left floor patch
    [1.5, 0.35, -2.5, 0.9], // Rear Right floor patch
  ]

  mudClumps.forEach(([mx, my, mz, ms]) => {
    const clump = new THREE.Mesh(clumpGeo, stickyMat)
    clump.position.set(mx, my, mz)
    clump.scale.set(ms * 1.3, ms * 0.65, ms * 1.1)
    group.add(clump)
  })

  group.visible = false
  return { group, floorMesh }
}

function createGroundDumpPile(scene) {
  const group = new THREE.Group()
  // Located on the ground (Y=0.0) directly behind the dump truck tailgate
  group.position.set(0.95, 0.0, -1.95)
  group.scale.set(0.0001, 0.0001, 0.0001)

  // Conical ground pile of dumped soil and earth
  const coneGeo = new THREE.ConeGeometry(1.8, 0.86, 28)
  const cPos = coneGeo.attributes.position
  for (let i = 0; i < cPos.count; i++) {
    const y = cPos.getY(i)
    if (y < 0) {
      cPos.setY(i, 0)
    } else {
      const x = cPos.getX(i)
      const z = cPos.getZ(i)
      cPos.setY(i, y + Math.sin(x * 3.2) * Math.cos(z * 3.2) * 0.07)
    }
  }
  coneGeo.computeVertexNormals()

  const pileMat = new THREE.MeshStandardMaterial({
    color: '#634125',
    roughness: 0.96,
    metalness: 0.03,
  })

  const pileMesh = new THREE.Mesh(coneGeo, pileMat)
  pileMesh.position.y = 0.43
  pileMesh.castShadow = true
  pileMesh.receiveShadow = true
  group.add(pileMesh)

  // Flattened base soil apron spread out around the ground mound
  const apronMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(2.3, 2.5, 0.06, 28),
    pileMat,
  )
  apronMesh.position.y = 0.03
  apronMesh.receiveShadow = true
  group.add(apronMesh)

  // 16 small soil clods scattered across the dumped pile (crumbly earth, NO rocks!)
  const clodGeo = new THREE.SphereGeometry(0.16, 8, 8)
  const clodMat = new THREE.MeshStandardMaterial({
    color: '#52341b',
    roughness: 0.98,
    metalness: 0.02,
  })

  const gClodOffsets = [
    [0.0, 0.82, 0.0, 1.2],
    [-0.4, 0.68, 0.3, 1.0],
    [0.5, 0.64, -0.3, 1.1],
    [-0.6, 0.48, -0.5, 0.9],
    [0.6, 0.44, 0.5, 0.85],
    [-0.2, 0.54, 0.7, 0.95],
    [0.2, 0.54, -0.7, 0.9],
    [-1.0, 0.24, 0.2, 0.8],
    [1.1, 0.22, -0.1, 0.85],
    [-0.7, 0.22, 0.9, 0.75],
    [0.8, 0.2, 0.8, 0.7],
    [-0.9, 0.2, -0.8, 0.8],
    [0.7, 0.18, -1.0, 0.75],
    [0.0, 0.16, 1.3, 0.65],
    [-1.3, 0.1, 0.4, 0.6],
    [1.3, 0.1, -0.3, 0.65],
  ]

  gClodOffsets.forEach(([gx, gy, gz, gs]) => {
    const clod = new THREE.Mesh(clodGeo, clodMat)
    clod.position.set(gx, gy, gz)
    clod.scale.set(gs, gs * 0.6, gs)
    clod.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    clod.castShadow = true
    group.add(clod)
  })

  scene.add(group)
  return { group, pileMesh }
}

function createFallingDebrisSystem(scene) {
  const group = new THREE.Group()
  scene.add(group)

  // Pool of physically animated falling soil clods in world space
  const fallingClods = []
  const clodGeo = new THREE.SphereGeometry(0.12, 8, 8)
  const clodMat = new THREE.MeshStandardMaterial({
    color: '#52341b',
    roughness: 0.98,
    metalness: 0.02,
  })

  for (let i = 0; i < 20; i++) {
    const mesh = new THREE.Mesh(clodGeo, clodMat)
    mesh.castShadow = true
    mesh.visible = false
    group.add(mesh)

    fallingClods.push({
      mesh,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      rotVel: new THREE.Vector3(),
      active: false,
      scale: 0.6 + Math.random() * 0.7,
      timer: (i / 20) * 1.5,
    })
  }

  // 140 Cascading dark soil and fine earth particles pouring to the ground
  const cascadeCount = 140
  const cascadeGeo = new THREE.BufferGeometry()
  const cascadePos = new Float32Array(cascadeCount * 3)
  const cascadeColors = new Float32Array(cascadeCount * 3)
  const c1 = new THREE.Color('#785131')
  const c2 = new THREE.Color('#462d18')

  for (let i = 0; i < cascadeCount; i++) {
    cascadePos[i * 3] = 0.95 + (Math.random() - 0.5) * 0.6
    cascadePos[i * 3 + 1] = 1.25 - Math.random() * 1.2
    cascadePos[i * 3 + 2] = -1.6 - Math.random() * 0.5
    const mix = c1.clone().lerp(c2, Math.random())
    cascadeColors[i * 3] = mix.r
    cascadeColors[i * 3 + 1] = mix.g
    cascadeColors[i * 3 + 2] = mix.b
  }
  cascadeGeo.setAttribute('position', new THREE.BufferAttribute(cascadePos, 3))
  cascadeGeo.setAttribute('color', new THREE.BufferAttribute(cascadeColors, 3))

  const cascadeMat = new THREE.PointsMaterial({
    size: 0.2,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
  })
  const cascadePoints = new THREE.Points(cascadeGeo, cascadeMat)
  cascadePoints.visible = false
  group.add(cascadePoints)

  return { group, fallingClods, cascadePoints, cascadePos, cascadeGeo, cascadeCount }
}

function createFallbackTruck() {
  const truck = new THREE.Group()
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#177447', roughness: 0.7 })
  const darkMaterial = new THREE.MeshStandardMaterial({ color: '#263832', roughness: 0.8 })
  const glassMaterial = new THREE.MeshStandardMaterial({ color: '#a9d5d0', roughness: 0.25 })

  // Chassis base
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 3.7), bodyMaterial)
  chassis.position.set(0, 0.75, 0)
  chassis.castShadow = true
  truck.add(chassis)

  // Cab at +Z
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.25, 1.15), bodyMaterial)
  cab.position.set(0, 1.45, 1.2)
  cab.castShadow = true
  truck.add(cab)

  // Windshield
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.5, 0.7), glassMaterial)
  glass.position.set(0, 1.68, 1.2)
  truck.add(glass)

  // Wheels
  for (const z of [-1.25, 1.25]) {
    for (const x of [-0.82, 0.82]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 24), darkMaterial)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, 0.45, z)
      wheel.castShadow = true
      truck.add(wheel)
    }
  }

  // Dump bed body at -Z
  const bedBox = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.8), bodyMaterial)
  bedBox.position.set(0, 1.35, -0.85)
  bedBox.castShadow = true
  truck.add(bedBox)

  return { truck, bedBox }
}

function TruckVisualization({
  phase,
  onSelectPhase,
  simulationRunning,
  prediction,
  zoneRisk,
}) {
  const mountRef = useRef(null)
  const phaseRef = useRef(phase)
  const [interactiveCarryback, setInteractiveCarryback] = useState(null)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    setInteractiveCarryback(null)
  }, [prediction])

  // Determine current active carryback percentage
  let defaultCarryback = 0
  if (prediction) {
    if (prediction.prediction === 1) {
      const prob = prediction.carryback_probability != null ? prediction.carryback_probability : 0.85
      defaultCarryback = Math.max(8, Math.round(prob * 25))
    } else {
      defaultCarryback = 0
    }
  } else {
    defaultCarryback = 12 // Default for interactive testing in Stage 5
  }
  const carrybackPct = interactiveCarryback != null ? interactiveCarryback : defaultCarryback
  const carrybackRef = useRef(carrybackPct)
  useEffect(() => {
    carrybackRef.current = carrybackPct
  }, [carrybackPct])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#f7faf9')

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 1000)
    camera.position.set(5.8, 3.9, 6.4)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = false
    controls.minDistance = 3.5
    controls.maxDistance = 11
    controls.target.set(0, 0.8, 0)

    scene.add(new THREE.HemisphereLight('#ffffff', '#b9cfc5', 2.2))
    const keyLight = new THREE.DirectionalLight('#ffffff', 3.2)
    keyLight.position.set(4, 8, 5)
    keyLight.castShadow = true
    scene.add(keyLight)

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(5.8, 64),
      new THREE.MeshStandardMaterial({ color: '#e8efec', roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    ground.receiveShadow = true
    scene.add(ground)

    const grid = new THREE.GridHelper(11, 22, '#c7d9d1', '#dfeae5')
    grid.position.y = 0
    scene.add(grid)

    const fallback = createFallbackTruck()
    let truck = fallback.truck
    let frameId
    scene.add(truck)

    // Dump hoist pivot holding the high-volume truck bed payload AND the truck bed body itself!
    const dumpHoist = new THREE.Group()
    const soilPayload = createSoilBedPayload()
    const retainedSoil = createRetainedCarrybackLayer()

    // Ground dump pile and falling debris in world coordinates
    const groundDumpPile = createGroundDumpPile(scene)
    const fallingDebris = createFallingDebrisSystem(scene)

    // Attach to fallback truck initially:
    dumpHoist.position.set(0, 0.9, -1.6)
    soilPayload.pivot.position.set(0, 0.45, 0.75)
    soilPayload.pivot.scale.set(0.24, 0.24, 0.24)
    dumpHoist.add(soilPayload.pivot)

    retainedSoil.group.position.set(0, 0.45, 0.75)
    retainedSoil.group.scale.set(0.24, 0.24, 0.24)
    dumpHoist.add(retainedSoil.group)

    truck.add(dumpHoist)
    truck.add(soilPayload.loadingParticles)

    truck.updateMatrixWorld(true)
    dumpHoist.updateMatrixWorld(true)
    dumpHoist.attach(fallback.bedBox)

    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.load(
      '/models/CATERPILLAR_MINING_TRUCK.glb',
      (gltf) => {
        scene.remove(truck)
        truck = gltf.scene

        // Identification of dump bed body meshes in the Caterpillar GLB model
        const bedPartNames = new Set([
          'id7681', 'id7700', 'id7709', 'id7718', 'id7727', 'id7736',
          'id7745', 'id7754', 'id7767', 'id7780', 'id7796', 'id7807',
        ])
        const bedObjectsToAttach = []

        truck.traverse((object) => {
          if (!object.isMesh) return
          object.castShadow = true
          object.receiveShadow = true
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material]
          const isBrandingMesh = materials.some((material) => {
            const image = material.map?.image
            return (
              (image?.width === 1613 && image?.height === 1189) ||
              (image?.width === 1637 && image?.height === 320)
            )
          })
          if (isBrandingMesh) object.visible = false

          const lowerName = object.name.toLowerCase()
          if (bedPartNames.has(lowerName)) {
            bedObjectsToAttach.push(object)
          }
        })

        truck.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(truck)
        const size = bounds.getSize(new THREE.Vector3())
        const largestDimension = Math.max(size.x, size.y, size.z)
        truck.scale.setScalar(4.4 / largestDimension)
        truck.updateMatrixWorld(true)

        const centeredBounds = new THREE.Box3().setFromObject(truck)
        const centered = centeredBounds.getCenter(new THREE.Vector3())
        truck.position.x -= centered.x
        truck.position.z -= centered.z
        truck.position.y += 0.18 - centeredBounds.min.y
        truck.rotation.y = -0.52

        // Mount dump hoist at the rear bed hinge in Caterpillar truck coordinates
        dumpHoist.position.set(0, 3.8, -5.8)

        // Mount soil payload and retained carryback inside the dump box cavity
        soilPayload.pivot.position.set(0, -0.2, 4.8)
        soilPayload.pivot.scale.set(1.0, 1.0, 1.0)
        dumpHoist.add(soilPayload.pivot)

        retainedSoil.group.position.set(0, -0.35, 4.8)
        retainedSoil.group.scale.set(1.0, 1.0, 1.0)
        dumpHoist.add(retainedSoil.group)

        truck.add(dumpHoist)
        truck.add(soilPayload.loadingParticles)

        // CRITICAL: Attach the Caterpillar truck's dump bed body meshes to dumpHoist so the TRUCK BED RISES!
        truck.updateMatrixWorld(true)
        dumpHoist.updateMatrixWorld(true)
        bedObjectsToAttach.forEach((obj) => {
          dumpHoist.attach(obj)
        })

        scene.add(truck)
        controls.target.set(0, 1.2, 0)
        controls.update()
      },
      undefined,
      (error) => {
        console.error('Failed to load detailed truck model:', error)
      },
    )

    const resize = () => {
      const width = mount.clientWidth
      const height = mount.clientHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(mount)

    let currentFill = 0.0
    let currentTilt = 0.0
    let currentSlide = 0.0
    let groundPileScale = 0.0
    let lastTime = performance.now()

    const animate = () => {
      frameId = requestAnimationFrame(animate)

      const now = performance.now()
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      const phaseKey = normalizePhase(phaseRef.current)

      let targetTilt = 0.0
      let targetFill = 0.0

      if (phaseKey === 'loading') {
        targetTilt = 0.0
        targetFill = 1.0
      } else if (phaseKey === 'loaded') {
        targetTilt = 0.0
        targetFill = 1.0
      } else if (phaseKey === 'unloading') {
        targetTilt = -0.82 // ~47 degree dump bed hoist tilt: truck bed rises into the air!
        targetFill = 0.0 // unloads smoothly onto the ground
      } else {
        // empty or post_unload
        targetTilt = 0.0
        targetFill = 0.0
      }

      // Smooth hydraulic hoist tilt: tilts dumpHoist AND all attached bed body meshes!
      currentTilt = THREE.MathUtils.lerp(currentTilt, targetTilt, 0.045)
      dumpHoist.rotation.x = currentTilt

      // Subtle suspension recoil under hoist displacement
      if (truck) truck.rotation.x = currentTilt * 0.035

      // Fill / Dump progress transitions
      if (phaseKey === 'loading') {
        currentFill = Math.min(1.0, currentFill + dt * 0.38)
        currentSlide = THREE.MathUtils.lerp(currentSlide, 0.0, 0.08)
        groundPileScale = THREE.MathUtils.lerp(groundPileScale, 0.0, 0.1)
        retainedSoil.group.visible = false
      } else if (phaseKey === 'loaded') {
        currentFill = THREE.MathUtils.lerp(currentFill, 1.0, 0.08)
        currentSlide = THREE.MathUtils.lerp(currentSlide, 0.0, 0.08)
        groundPileScale = THREE.MathUtils.lerp(groundPileScale, 0.0, 0.1)
        retainedSoil.group.visible = false
      } else if (phaseKey === 'unloading') {
        if (Math.abs(currentTilt) > 0.2) {
          // Soil slides back down the tilted bed toward tailgate chute
          currentSlide = THREE.MathUtils.lerp(currentSlide, -3.8, dt * 0.85)
          currentFill = Math.max(0.0, currentFill - dt * 0.32)
          // Ground pile on the floor expands continuously as soil discharges!
          groundPileScale = Math.min(1.0, (1.0 - currentFill) * 1.05)
        }
        retainedSoil.group.visible = false
      } else if (phaseKey === 'post_unload') {
        // Bed lowers down completely flat!
        currentFill = THREE.MathUtils.lerp(currentFill, 0.0, 0.15)
        currentSlide = THREE.MathUtils.lerp(currentSlide, 0.0, 0.15)
        groundPileScale = THREE.MathUtils.lerp(groundPileScale, 1.0, 0.06)

        // RETAINED MATERIAL BASED ON CARRYBACK PERCENTAGE:
        const pct = carrybackRef.current
        if (pct > 0) {
          retainedSoil.group.visible = true
          const rScale = Math.max(0.2, Math.min(1.4, pct / 15))
          retainedSoil.group.scale.set(1.0, rScale, 1.0)
        } else {
          retainedSoil.group.visible = false
        }
      } else {
        // Empty baseline: clean bed and cleared ground
        currentFill = THREE.MathUtils.lerp(currentFill, 0.0, 0.15)
        currentSlide = THREE.MathUtils.lerp(currentSlide, 0.0, 0.15)
        groundPileScale = THREE.MathUtils.lerp(groundPileScale, 0.0, 0.15)
        retainedSoil.group.visible = false
      }

      // Update Ground Dump Pile scale and visibility
      const gScaleClamped = Math.max(0.0001, groundPileScale)
      groundDumpPile.group.scale.set(gScaleClamped, gScaleClamped, gScaleClamped)
      groundDumpPile.group.visible = groundPileScale > 0.02

      // Update Truck Bed Soil Heap
      if (currentFill > 0.002) {
        soilPayload.pivot.visible = true
        const fillClamped = Math.max(0.001, currentFill)
        const horizScale = Math.min(1.0, 0.3 + fillClamped * 0.7)
        soilPayload.moundMesh.scale.set(horizScale, fillClamped, horizScale)
        soilPayload.baseBox.scale.set(horizScale, fillClamped, horizScale)
        soilPayload.moundMesh.position.z = currentSlide * (1.0 - currentFill)
        soilPayload.baseBox.position.z = currentSlide * (1.0 - currentFill)

        soilPayload.soilClods.forEach((clod) => {
          clod.scale.copy(clod.userData.originScale).multiplyScalar(fillClamped)
          clod.position.z = clod.userData.originPos.z + currentSlide * (1.0 - currentFill)
        })
      } else {
        soilPayload.pivot.visible = false
      }

      // Update Overhead Excavator Loading Particles (Soil Stream)
      const loadCount = soilPayload.loadCount
      const lPos = soilPayload.loadPos
      if (phaseKey === 'loading' && currentFill < 0.98) {
        soilPayload.loadingParticles.visible = true
        for (let i = 0; i < loadCount; i++) {
          lPos[i * 3 + 1] -= dt * 7.5
          if (lPos[i * 3 + 1] < 1.2) {
            lPos[i * 3] = (Math.random() - 0.5) * 3.4
            lPos[i * 3 + 1] = Math.random() * 2.8 + 4.2
            lPos[i * 3 + 2] = (Math.random() - 0.5) * 4.2
          }
        }
        soilPayload.loadGeom.attributes.position.needsUpdate = true
      } else {
        soilPayload.loadingParticles.visible = false
      }

      // Update Falling Soil Chunks and Tailgate Discharge Cascade onto the Ground
      const isDumping = phaseKey === 'unloading' && Math.abs(currentTilt) > 0.22 && currentFill > 0.02

      if (isDumping) {
        fallingDebris.cascadePoints.visible = true
        const cCount = fallingDebris.cascadeCount
        const cPos = fallingDebris.cascadePos
        for (let i = 0; i < cCount; i++) {
          cPos[i * 3 + 1] -= dt * 6.5
          cPos[i * 3 + 2] -= dt * 2.8
          if (cPos[i * 3 + 1] < 0.05) {
            cPos[i * 3] = 0.95 + (Math.random() - 0.5) * 0.7
            cPos[i * 3 + 1] = 1.24 + Math.random() * 0.12
            cPos[i * 3 + 2] = -1.55 - Math.random() * 0.35
          }
        }
        fallingDebris.cascadeGeo.attributes.position.needsUpdate = true

        // Physics tumble for falling soil clods
        fallingDebris.fallingClods.forEach((item) => {
          if (!item.active) {
            item.timer -= dt
            if (item.timer <= 0) {
              item.active = true
              item.mesh.visible = true
              item.mesh.scale.setScalar(item.scale)
              item.pos.set(
                0.95 + (Math.random() - 0.5) * 0.65,
                1.26 + Math.random() * 0.1,
                -1.55 - Math.random() * 0.3,
              )
              item.vel.set(
                (Math.random() - 0.5) * 0.35,
                -0.1 - Math.random() * 0.25,
                -0.45 - Math.random() * 0.5,
              )
              item.rotVel.set(
                Math.random() * 8 - 4,
                Math.random() * 8 - 4,
                Math.random() * 8 - 4,
              )
            }
          } else {
            item.vel.y -= 5.5 * dt
            item.pos.addScaledVector(item.vel, dt)
            item.mesh.position.copy(item.pos)
            item.mesh.rotation.x += item.rotVel.x * dt
            item.mesh.rotation.y += item.rotVel.y * dt

            const pileHeight = 0.08 + groundPileScale * 0.45
            if (item.pos.y <= pileHeight) {
              if (Math.random() > 0.45 && isDumping) {
                item.pos.set(
                  0.95 + (Math.random() - 0.5) * 0.65,
                  1.26 + Math.random() * 0.1,
                  -1.55 - Math.random() * 0.3,
                )
                item.vel.set(
                  (Math.random() - 0.5) * 0.35,
                  -0.1 - Math.random() * 0.25,
                  -0.45 - Math.random() * 0.5,
                )
              } else {
                item.pos.y = pileHeight
                item.vel.set(0, 0, 0)
              }
            }
          }
        })
      } else {
        fallingDebris.cascadePoints.visible = false
        fallingDebris.fallingClods.forEach((item) => {
          item.mesh.visible = false
          item.active = false
          item.timer = Math.random() * 0.8
        })
      }

      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      scene.traverse((object) => {
        if (!object.isMesh) return
        object.geometry.dispose()
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => material.dispose())
        } else {
          object.material.dispose()
        }
      })
    }
  }, [])

  const currentStep = PHASE_STEP_INFO[normalizePhase(phase)] || PHASE_STEP_INFO.empty
  const isPostInspection = normalizePhase(phase) === 'post_unload'

  return (
    <div className="truck-viz-container">
      {/* 5-Phase Interactive Stepper Bar */}
      <div className="phase-stepper-bar" role="tablist" aria-label="Cycle phases">
        {PHASE_ORDER.map((pKey) => {
          const info = PHASE_STEP_INFO[pKey]
          const isActive = normalizePhase(phase) === pKey
          return (
            <button
              key={pKey}
              type="button"
              className={`phase-step-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelectPhase && onSelectPhase(pKey)}
              disabled={simulationRunning}
              title={info.subtitle}
            >
              <span className="phase-step-num">{info.num}</span>
              <span className="phase-step-label">{info.title}</span>
            </button>
          )
        })}
      </div>

      {/* 3D WebGL Canvas */}
      <div ref={mountRef} className="truck-visualization" aria-label="3D truck phase visualization" />

      {/* HUD Telemetry Overlay */}
      <div className="viz-hud-overlay">
        <div className="viz-hud-pill">
          <span className="viz-hud-icon">{currentStep.icon}</span>
          <div>
            <div className="viz-hud-title">STAGE {currentStep.num}: {currentStep.title}</div>
            <div className="viz-hud-desc">
              {isPostInspection
                ? carrybackPct > 0
                  ? `Retaining ${carrybackPct}% sticky soil in bed`
                  : '0.0% carryback · Clean steel bed'
                : currentStep.subtitle}
            </div>
          </div>
        </div>
        <div className="viz-hud-telemetry">
          {isPostInspection ? (
            <div className="carryback-stepper-presets">
              <span style={{ fontSize: '9px', fontWeight: 800, color: '#4a5953', marginRight: '3px' }}>
                CARRYBACK:
              </span>
              {[0, 8, 18, 28].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  className={`carryback-preset-btn ${carrybackPct === pct ? (pct > 0 ? 'active warn' : 'active') : ''}`}
                  onClick={() => setInteractiveCarryback(pct)}
                  title={`Test ${pct}% carryback retention in bed`}
                >
                  {pct}%
                </button>
              ))}
            </div>
          ) : (
            <div className="viz-hud-metric">
              STATUS: <span>{currentStep.tag.toUpperCase()}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function App() {
  const [trips, setTrips] = useState([])
  const [tripId, setTripId] = useState('TRIP_0001')
  const [prediction, setPrediction] = useState(null)
  const [zoneData, setZoneData] = useState(null)
  const [zoneRisk, setZoneRisk] = useState(null)
  const [simulationHistory, setSimulationHistory] = useState([])
  const [page, setPage] = useState('Dashboard')

  const [loading, setLoading] = useState(false)
  const [simulationRunning, setSimulationRunning] = useState(false)
  const [simulationComplete, setSimulationComplete] = useState(false)
  const [currentPhase, setCurrentPhase] = useState('Ready')
  const [currentRecord, setCurrentRecord] = useState(null)
  const [totalRecords, setTotalRecords] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const runIdRef = useRef(0)

  const loadTrip = useCallback(async (id) => {
    runIdRef.current += 1
    setSimulationRunning(false)
    setSimulationComplete(false)
    setCurrentPhase('Ready')
    setCurrentRecord(null)
    setTotalRecords(0)
    setZoneRisk(null)
    setPrediction(null)
    setZoneData(null)
    setTripId(id)
    setError('')
    setLoading(true)

    try {
      const [summary, referenceZones, initialPrediction] = await Promise.all([
        getSensorSummary(id),
        getTripZones(id).catch(() => null),
        getPrediction(id).catch(() => null),
      ])

      setTotalRecords(Number(summary.total_records) || 0)
      setZoneData(referenceZones)
      if (initialPrediction) setPrediction(initialPrediction)
    } catch (err) {
      setError(
        err.response?.data?.detail ??
          'Unable to load the selected trip sensor records.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setError('')
    setLoading(true)

    try {
      const tripResult = await getTrips()
      const availableTrips = tripResult.trips || []
      setTrips(availableTrips)

      const selected =
        availableTrips.find((trip) => trip.trip_id === tripId) ??
        availableTrips[0]

      if (selected) {
        await loadTrip(selected.trip_id)
      }
    } catch {
      setError('Unable to connect to the CARRYX backend.')
    } finally {
      setLoading(false)
    }
  }, [loadTrip, tripId])

  useEffect(() => {
    refresh()
    return () => {
      runIdRef.current += 1
    }
  }, []) // Initial load only.

  const stopSimulation = useCallback(() => {
    runIdRef.current += 1
    setSimulationRunning(false)
    setCurrentPhase('Simulation stopped')
    setNotice('Simulation stopped. No physical truck command was sent.')
  }, [])

  const startSimulation = useCallback(async () => {
    const thisRun = runIdRef.current + 1
    runIdRef.current = thisRun

    setError('')
    setNotice('')
    setSimulationRunning(true)
    setSimulationComplete(false)
    setCurrentRecord(null)
    setZoneRisk(null)
    setPrediction(null)
    setCurrentPhase('Preparing sensor replay…')

    try {
      const summary = await getSensorSummary(tripId)
      const total = Number(summary.total_records) || 0
      setTotalRecords(total)

      if (total === 0) {
        throw new Error('This trip has no sensor records.')
      }

      let offset = 0
      let lastPhase = ''
      const batchSize = 20

      while (offset < total) {
        if (runIdRef.current !== thisRun) return

        const response = await getSensorRecords(
          tripId,
          offset,
          Math.min(batchSize, total - offset),
        )

        const records = response.records || []
        if (records.length === 0) break

        for (const record of records) {
          if (runIdRef.current !== thisRun) return

          const phase = getPhase(record)
          if (phase && phase !== lastPhase) {
            lastPhase = phase
            setCurrentPhase(PHASE_LABELS[phase] ?? phase)
          }

          setCurrentRecord(record)

          // Delay gives the operator time to see changing sensor readings.
          await new Promise((resolve) => setTimeout(resolve, 8))
        }

        offset += records.length
      }

      if (runIdRef.current !== thisRun) return

      setCurrentPhase('Analysing post-unload sensor readings…')

      const [predictionResult, riskResult, groundTruth] = await Promise.all([
        getPrediction(tripId),
        fetch(`http://127.0.0.1:8000/zone-risk/${encodeURIComponent(tripId)}`)
          .then(async (response) => {
            const data = await response.json()
            if (!response.ok) {
              throw new Error(data.detail || 'Zone-risk calculation failed.')
            }
            return data
          }),
        getTripZones(tripId).catch(() => null),
      ])

      if (runIdRef.current !== thisRun) return

      const normalizedRiskResult =
        predictionResult?.prediction === 1
          ? riskResult
          : {
              ...(riskResult ?? {}),
              zones: (riskResult?.zones ?? []).map((zone) => ({
                ...zone,
                risk_score: 0,
                risk_level: 'low',
              })),
            }

      setPrediction(predictionResult)
      setZoneRisk(normalizedRiskResult)
      setZoneData(groundTruth)
      setSimulationComplete(true)
      setCurrentPhase('Post-unload analysis complete')
      setNotice('Sensor replay and post-unload analysis completed.')
      const tripDetails = trips.find((trip) => trip.trip_id === tripId)
      const detectedCarryback = predictionResult?.prediction === 1
      setSimulationHistory((history) => [
        {
          id: `${tripId}-${Date.now()}`,
          tripId,
          truckId: tripDetails?.truck_id ?? 'Unknown truck',
          modelResult: detectedCarryback ? 'CARRYBACK' : 'NOT DETECTED',
          severity: groundTruth?.severity
            ? String(groundTruth.severity).toUpperCase()
            : 'NOT EVALUATED',
          recommendedAction:
            groundTruth?.recommended_action ??
            (detectedCarryback ? 'Inspect the truck bed' : 'Review the sensor report'),
          recommendedActionDetail: groundTruth?.recommended_action_detail ?? '',
          simulatedAt: new Date().toISOString(),
        },
        ...history,
      ])
    } catch (err) {
      if (runIdRef.current !== thisRun) return
      setError(
        err.response?.data?.detail ??
          err.message ??
          'Simulation failed. Check that the backend is running.',
      )
      setCurrentPhase('Simulation failed')
    } finally {
      if (runIdRef.current === thisRun) {
        setSimulationRunning(false)
      }
    }
  }, [tripId, trips])

  const detected = prediction?.prediction === 1
  const risk = prediction
    ? Math.round(Number(prediction.carryback_probability ?? 0) * 100)
    : null

  const actualZoneId =
    zoneData?.actual_residual_zone == null
      ? null
      : Number(zoneData.actual_residual_zone)

  const retainedMass = zoneData?.actual_residual_mass_kg
  const actualSeverity = zoneData?.severity
    ? String(zoneData.severity).toUpperCase()
    : 'NOT EVALUATED'
  const stickinessIndex = zoneData?.stickiness_index
  const residualLimit = zoneData?.residual_allowed_limit_kg
  const residualPersistence = zoneData?.residual_persistence_seconds
  const recommendedAction = zoneData?.recommended_action ?? null
  const recommendedActionDetail = zoneData?.recommended_action_detail ?? null

  const zoneScores = (zoneRisk?.zones ?? []).map((zone) => {
    if (!prediction || Number(prediction.prediction) !== 1) {
      return { ...zone, risk_score: 0, risk_level: 'low' }
    }
    return zone
  })
  const getZoneScore = (zoneId) =>
    zoneScores.find((zone) => Number(zone.zone_id) === zoneId)

  const getLiveValue = (keys) => {
    if (!currentRecord) return '—'
    for (const key of keys) {
      if (currentRecord[key] != null && Number.isFinite(Number(currentRecord[key]))) {
        return Number(currentRecord[key]).toFixed(3)
      }
    }
    return '—'
  }

  return (
    <div className="carryx">
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo-wrap">
            <img
              className="brand-logo"
              src="/carryx-logo.png"
              alt="CARRYX mining truck logo"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
                event.currentTarget.nextElementSibling.style.display = 'grid'
              }}
            />
            <div className="brand-mark">
            <Zap size={21} fill="currentColor" />
            </div>
          </div>
          <div>
            <div className="brand-name">CARRYX</div>
          </div>
        </div>

        <nav className="topnav">
          {[
            { name: 'Dashboard', icon: LayoutDashboard },
            { name: 'Trip History', icon: History },
          ].map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.name}
                className={`nav-button ${page === item.name ? 'selected' : ''}`}
                onClick={() => setPage(item.name)}
              >
                <Icon size={14} />
                {item.name}
              </button>
            )
          })}
        </nav>

        <div className="top-actions">
          <span className="clock">
            <Clock size={13} />
            {new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <button className="icon-button" onClick={refresh} title="Refresh data">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      {notice && (
        <div className="notice">
          {notice}
          <button onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}

      {error && (
        <div className="error-banner">
          <AlertTriangle size={17} />
          {error}
        </div>
      )}

      {page === 'Dashboard' ? (
        <>
          <section className="dashboard-intro">
            <div className="dashboard-intro-copy">
              <span className="dashboard-eyebrow">FIELD OPERATIONS · CARRYBACK DETECTION</span>
              <h1>Truck-bed intelligence</h1>
              <p>Live sensor replay and post-unload insights, all in one place.</p>
            </div>
            <div className="intro-trip-card">
              <span>SELECTED TRIP</span>
              <strong>{tripId}</strong>
              <small>{trips.find((trip) => trip.trip_id === tripId)?.truck_id ?? 'Truck details loading'}</small>
            </div>
            <div className={`intro-live-status ${simulationRunning ? 'is-running' : ''}`}>
              <span />
              {simulationRunning ? 'SIMULATION LIVE' : 'MONITORING READY'}
            </div>
          </section>

          <section className="metrics">
            <Metric label="MODEL RESULT" tone="pink" icon={<ShieldAlert size={14} />}>
              {!simulationComplete
                ? 'PENDING'
                : detected
                  ? 'CARRYBACK'
                  : 'NOT DETECTED'}
            </Metric>
            <Metric label="RECORDED RESIDUAL" tone="yellow" icon={<Truck size={14} />}>
              {simulationComplete && retainedMass != null
                ? `${formatNumber(retainedMass)} KG`
                : '—'}
            </Metric>
            <Metric label="RECORDED ZONE" tone="green" icon={<MapPin size={14} />}>
              {simulationComplete
                ? zoneData?.actual_residual_zone_name ?? 'NONE'
                : '—'}
            </Metric>
            <Metric label="RECORDED SEVERITY" tone="red" icon={<Activity size={14} />}>
              {simulationComplete ? actualSeverity : '—'}
            </Metric>
          </section>

          <section className="panel live-panel">
            <div className="panel-heading">
              <h2>LIVE SENSOR REPLAY</h2>
              <span className="panel-subtitle">
                {currentRecord ? `Current phase: ${getPhase(currentRecord) || 'unknown'}` : 'No active reading'}
              </span>
            </div>
            <div className="live-readings">
              <div><span>Remaining/load weight</span><strong>{getLiveValue(['weight_kg', 'weight'])} kg</strong></div>
              <div><span>IMU acceleration X</span><strong>{getLiveValue(['accel_x_g'])} g</strong></div>
              <div><span>IMU acceleration Y</span><strong>{getLiveValue(['accel_y_g'])} g</strong></div>
              <div><span>IMU acceleration Z</span><strong>{getLiveValue(['accel_z_g'])} g</strong></div>
              <div><span>Angular velocity X</span><strong>{getLiveValue(['gyro_x_dps'])} °/s</strong></div>
              <div><span>Sensor timestamp</span><strong>{currentRecord?.timestamp ?? '—'}</strong></div>
            </div>
          </section>

          <main className="dashboard-grid">
            <section className="panel payload-panel">
              <div className="panel-heading">
                <div>
                  <h2>TRUCK BED ZONE-RISK MAP</h2>
                  <p className="panel-subtitle">
                    {tripId} · {simulationComplete ? 'Analysis complete' : 'Awaiting simulation'}
                  </p>
                </div>
                <span className="status-pill">
                  {simulationComplete ? 'ANALYSED' : simulationRunning ? 'REPLAYING' : 'READY'}
                </span>
              </div>

              <div className="simulation-controls">
                <div className="simulation-action">
                  <button
                    className="execute-button"
                    onClick={startSimulation}
                    disabled={simulationRunning || loading}
                  >
                    <Play size={15} />
                    {simulationRunning ? 'SIMULATION RUNNING…' : 'START SIMULATION'}
                  </button>
                  {simulationRunning && (
                    <button className="icon-button" onClick={stopSimulation} title="Stop simulation">
                      <Square size={15} />
                    </button>
                  )}
                </div>
                <div className="phase-status">
                  <span className="phase-heading">CURRENT TRUCK PHASE</span>
                  <span className="phase-label">{currentPhase}</span>
                </div>
              </div>

              <div className="payload-stage">
                <div className="visualization-heading">
                  <span>3D PHASE VISUALIZATION</span>
                  <span>{currentPhase}</span>
                </div>
                <TruckVisualization
                  phase={currentPhase}
                  onSelectPhase={(pKey) => setCurrentPhase(PHASE_LABELS[pKey] || pKey)}
                  simulationRunning={simulationRunning}
                  prediction={prediction}
                  zoneRisk={zoneRisk}
                />
                <div className="payload-map">
                  {ZONE_LAYOUT.map((zone) => {
                    const score = getZoneScore(zone.id)
                    const level = score?.risk_level
                    const isReferenceZone =
                      simulationComplete && actualZoneId === zone.id

                    const classes = [
                      'zone',
                      score ? getRiskClass(level) : 'zone-neutral',
                      zone.wide ? 'zone-wide' : '',
                      isReferenceZone ? 'zone-affected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')

                    return (
                      <button
                        key={zone.id}
                        className={classes}
                        onClick={() => {
                          if (!simulationComplete || !score) {
                            setNotice('Run the simulation to calculate zone-risk scores.')
                            return
                          }

                          setNotice(
                            `${zone.name}: relative sensor-change score ${score.risk_score}/100 (${score.risk_level}). This is not a calibrated carryback probability.`,
                          )
                        }}
                        title={
                          score
                            ? `${zone.name}: ${score.risk_score}/100 relative sensor-change score`
                            : `${zone.name}: waiting for post-unload analysis`
                        }
                      >
                        <span className="zone-name">{zone.name}</span>
                        <span className="zone-value">
                          {simulationComplete && score
                            ? `${formatNumber(score.risk_score)}`
                            : '—'}
                        </span>
                        <span className="zone-data-label">
                          {simulationComplete && score
                            ? `${String(level).toUpperCase()} RELATIVE RISK`
                            : 'Awaiting analysis'}
                        </span>
                        {isReferenceZone && (
                          <span className="reference-label">RECORDED ZONE</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

            </section>

            <aside className="right-column">
              <section className="panel risk-panel">
                <div className="panel-heading">
                  <h2><Activity size={15} /> PREDICTIVE RISK ENGINE</h2>
                </div>
                <div className="risk-content">
                  <div
                    className={`risk-ring ${detected ? 'risk-high' : 'risk-low'}`}
                    style={{ '--risk': `${risk ?? 0}%` }}
                  >
                    <div className="risk-inner">
                      <strong>{simulationComplete && risk != null ? `${risk}%` : '—'}</strong>
                      <span>MODEL PROBABILITY</span>
                    </div>
                  </div>
                  <p className="risk-caption">
                    {!simulationComplete
                      ? 'Run the simulation to obtain the trip-level model result.'
                      : detected
                        ? 'The saved model predicts carryback for this trip.'
                        : 'The saved model does not predict carryback for this trip.'}
                  </p>
                </div>
              </section>

              <section className="panel action-panel">
                <div className="panel-heading">
                  <h2><AlertTriangle size={15} /> RECOMMENDED ACTION</h2>
                </div>
                <div className="action-content">
                  <h3>
                    {!simulationComplete
                      ? 'Complete post-unload analysis'
                      : recommendedAction || (detected ? 'Inspect the truck bed' : 'Review the sensor report')}
                  </h3>
                  <p>
                    {!simulationComplete
                      ? 'Replay the recorded sensor sequence before generating the final report.'
                      : recommendedActionDetail || (detected
                        ? 'The trip-level model detected carryback. Inspect the bed before the next loading cycle.'
                        : 'The trip-level model did not detect carryback. Review the sensor-derived zone scores and recorded reference labels.')}
                  </p>
                  {simulationComplete && (
                    <div className="action-metrics">
                      <div>
                        <span>Residual mass</span>
                        <strong>{retainedMass != null ? `${formatNumber(retainedMass)} kg` : '—'}</strong>
                      </div>
                      <div>
                        <span>Allowed limit</span>
                        <strong>{residualLimit != null ? `${formatNumber(residualLimit, 2)} kg` : '—'}</strong>
                      </div>
                      <div>
                        <span>Above limit</span>
                        <strong>{residualPersistence != null ? `${formatNumber(residualPersistence, 1)} s` : '—'}</strong>
                      </div>
                      <div>
                        <span>Stickiness</span>
                        <strong>{stickinessIndex != null ? `${formatNumber(stickinessIndex, 2)}` : '—'}</strong>
                      </div>
                      <div>
                        <span>Severity</span>
                        <strong>{actualSeverity || 'NOT EVALUATED'}</strong>
                      </div>
                    </div>
                  )}
                </div>
              </section>

            </aside>
          </main>

          <section className="panel trip-strip">
            <div className="panel-heading">
              <h2>TRIP SELECTOR</h2>
              <button className="refresh-link" onClick={refresh} disabled={loading || simulationRunning}>
                <RefreshCw size={14} />
                {loading ? 'Loading…' : 'Refresh data'}
              </button>
            </div>
            <div className="trip-controls">
              <label htmlFor="trip-select">Select simulated trip</label>
              <select
                id="trip-select"
                value={tripId}
                onChange={(event) => loadTrip(event.target.value)}
                disabled={loading || simulationRunning}
              >
                {trips.map((trip) => (
                  <option key={trip.trip_id} value={trip.trip_id}>
                    {trip.trip_id} · {trip.truck_id}
                  </option>
                ))}
              </select>
              {simulationComplete && prediction && (
                <span className="prediction-summary">
                  {detected ? <AlertTriangle size={15} /> : <Check size={15} />}
                  {prediction.prediction_label} · {risk}% probability
                </span>
              )}
            </div>
          </section>
        </>
      ) : (
        <main className="simple-page panel">
          <h2>Trip History</h2>
          <p className="muted">Completed truck simulations and their results.</p>
          <div className="history-list">
            {simulationHistory.length === 0 ? (
              <p className="history-empty">
                No simulations yet. Run a truck trip from the Dashboard to add it here.
              </p>
            ) : (
              simulationHistory.map((record) => (
                <article
                  className={`history-entry ${record.modelResult === 'CARRYBACK' ? 'history-entry-alert' : ''}`}
                  key={record.id}
                >
                  <div className="history-entry-heading">
                    <div>
                      <strong>{record.tripId}</strong>
                      <small>{record.truckId}</small>
                    </div>
                    <time dateTime={record.simulatedAt}>
                      {new Date(record.simulatedAt).toLocaleString()}
                    </time>
                  </div>
                  <div className="history-entry-results">
                    <div>
                      <span>Model result</span>
                      <strong className={`history-result ${record.modelResult === 'CARRYBACK' ? 'history-result-alert' : 'history-result-clear'}`}>
                        {record.modelResult}
                      </strong>
                    </div>
                    <div>
                      <span>Recorded severity</span>
                      <strong className={`history-severity severity-${record.severity.toLowerCase().replace(/\s+/g, '-')}`}>
                        {record.severity}
                      </strong>
                    </div>
                    <div>
                      <span>Recommended action</span>
                      <strong>{record.recommendedAction}</strong>
                      {record.recommendedActionDetail && (
                        <small>{record.recommendedActionDetail}</small>
                      )}
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </main>
      )}

      <footer className="app-footer">
        <span>CARRYX · INDUSTRIAL CARRY-BACK MONITORING</span>
        <span>
          {simulationRunning
            ? 'Replaying recorded sensor data…'
            : 'Simulation environment · No physical truck commands are sent'}
        </span>
      </footer>
    </div>
  )
}

export default App
