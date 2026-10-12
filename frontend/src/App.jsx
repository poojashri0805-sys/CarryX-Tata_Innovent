
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

function createFallbackTruck() {
  const truck = new THREE.Group()
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#177447', roughness: 0.7 })
  const darkMaterial = new THREE.MeshStandardMaterial({ color: '#263832', roughness: 0.8 })
  const glassMaterial = new THREE.MeshStandardMaterial({ color: '#a9d5d0', roughness: 0.25 })

  const addBox = (size, position, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    truck.add(mesh)
  }

  addBox([3.7, 0.55, 1.55], [0, 0.75, 0], bodyMaterial)
  addBox([1.15, 1.25, 1.45], [1.2, 1.45, 0], bodyMaterial)
  addBox([0.7, 0.5, 1.48], [1.2, 1.68, 0], glassMaterial)
  addBox([1.8, 1.25, 1.5], [-0.85, 1.35, 0], bodyMaterial)

  for (const x of [-1.25, 1.25]) {
    for (const z of [-0.82, 0.82]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 24), darkMaterial)
      wheel.rotation.x = Math.PI / 2
      wheel.position.set(x, 0.45, z)
      wheel.castShadow = true
      truck.add(wheel)
    }
  }

  return truck
}

function TruckVisualization({ phase }) {
  const mountRef = useRef(null)
  const phaseRef = useRef(phase)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

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

    let truck = createFallbackTruck()
    let dumpBox = null
    let rubble = []
    let frameId
    scene.add(truck)

    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.load('/models/CATERPILLAR_MINING_TRUCK.glb', (gltf) => {
      scene.remove(truck)
      truck = gltf.scene
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
        const name = object.name.toLowerCase()
        if (name.includes('id4_box')) dumpBox = object
        if (name.includes('id8_rubble')) rubble.push(object)
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
      scene.add(truck)
      controls.target.set(0, 1.2, 0)
      controls.update()
    }, undefined, (error) => {
      console.error('Failed to load detailed truck model:', error)
    })

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

    const animate = () => {
      frameId = requestAnimationFrame(animate)
      if (dumpBox) {
        const phaseName = phaseRef.current.toLowerCase()
        const targetTilt = phaseName.includes('unloading') ? -0.62 : 0
        dumpBox.rotation.x = THREE.MathUtils.lerp(dumpBox.rotation.x, targetTilt, 0.06)
      }
      if (rubble.length) {
        const hidden = phaseRef.current.toLowerCase().includes('post-unload')
        rubble.forEach((part) => {
          part.visible = !hidden
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

  return <div ref={mountRef} className="truck-visualization" aria-label="3D truck phase visualization" />
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
      const [summary, referenceZones] = await Promise.all([
        getSensorSummary(id),
        getTripZones(id).catch(() => null),
      ])

      setTotalRecords(Number(summary.total_records) || 0)
      setZoneData(referenceZones)
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
                <TruckVisualization phase={currentPhase} />
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
