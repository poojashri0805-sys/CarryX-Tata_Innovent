
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  Clock,
  Database,
  History,
  LayoutDashboard,
  MapPin,
  Play,
  RefreshCw,
  Settings,
  ShieldAlert,
  Square,
  Truck,
  Wifi,
  Zap,
} from 'lucide-react'

import {
  getHealth,
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

function App() {
  const [health, setHealth] = useState(null)
  const [trips, setTrips] = useState([])
  const [tripId, setTripId] = useState('TRIP_0001')
  const [prediction, setPrediction] = useState(null)
  const [zoneData, setZoneData] = useState(null)
  const [zoneRisk, setZoneRisk] = useState(null)
  const [page, setPage] = useState('Dashboard')

  const [loading, setLoading] = useState(false)
  const [simulationRunning, setSimulationRunning] = useState(false)
  const [simulationComplete, setSimulationComplete] = useState(false)
  const [simulationProgress, setSimulationProgress] = useState(0)
  const [currentPhase, setCurrentPhase] = useState('Ready')
  const [currentRecord, setCurrentRecord] = useState(null)
  const [recordsProcessed, setRecordsProcessed] = useState(0)
  const [totalRecords, setTotalRecords] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const runIdRef = useRef(0)

  const loadTrip = useCallback(async (id) => {
    runIdRef.current += 1
    setSimulationRunning(false)
    setSimulationComplete(false)
    setSimulationProgress(0)
    setCurrentPhase('Ready')
    setCurrentRecord(null)
    setRecordsProcessed(0)
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
      const [healthData, tripResult] = await Promise.all([
        getHealth(),
        getTrips(),
      ])

      setHealth(healthData)
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
    setSimulationProgress(0)
    setRecordsProcessed(0)
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
          setRecordsProcessed((previous) => previous + 1)
          setSimulationProgress(
            Math.min(100, Math.round(((offset + 1) / total) * 100)),
          )

          // Delay gives the operator time to see changing sensor readings.
          await new Promise((resolve) => setTimeout(resolve, 8))
        }

        offset += records.length
        setSimulationProgress(
          Math.min(100, Math.round((offset / total) * 100)),
        )
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
      setSimulationProgress(100)
      setSimulationComplete(true)
      setCurrentPhase('Post-unload analysis complete')
      setNotice('Sensor replay and post-unload analysis completed.')
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
  }, [tripId])

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
            <div className="operational">
              <span /> SIMULATION ENVIRONMENT
            </div>
          </div>
        </div>

        <nav className="topnav">
          {[
            { name: 'Dashboard', icon: LayoutDashboard },
            { name: 'Trip History', icon: History },
            { name: 'Settings', icon: Settings },
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
          <section className="metrics">
            <Metric label="MODEL RESULT" tone="pink" icon={<ShieldAlert size={14} />}>
              {!simulationComplete
                ? 'PENDING'
                : detected
                  ? 'CARRYBACK'
                  : 'NOT DETECTED'}
            </Metric>
            <Metric label="RECORDED RESIDUAL" tone="orange" icon={<Truck size={14} />}>
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
                <span className="phase-label">{currentPhase}</span>
              </div>

              <div className="simulation-progress">
                <div className="progress-track">
                  <div style={{ width: `${simulationProgress}%` }} />
                </div>
                <span>
                  {simulationProgress}% · {recordsProcessed.toLocaleString()} / {totalRecords.toLocaleString()} records
                </span>
              </div>

              <div className="payload-stage">
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

              <div className="map-legend">
                <span><i className="legend-green" /> Lower relative score</span>
                <span><i className="legend-yellow" /> Moderate relative score</span>
                <span><i className="legend-red" /> Higher relative score</span>
              </div>
              <p className="muted heatmap-disclaimer">
                Zone scores compare post-unload acceleration magnitude with the empty-bed baseline.
                They are experimental sensor indicators, not proof of retained material.
                The recorded ground-truth zone is marked separately after analysis.
              </p>
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

              <section className="panel connection-panel">
                <div className="connection-status">
                  <span className={`status-dot ${health?.status === 'healthy' ? 'online' : ''}`} />
                  <strong>BACKEND CONNECTION</strong>
                </div>
                <p><Wifi size={14} /> {health?.status === 'healthy' ? 'API connected' : 'Checking connection'}</p>
                <p><Database size={14} /> {health?.total_trips ?? 0} trips available</p>
                <p><Activity size={14} /> {totalRecords.toLocaleString()} records in selected trip</p>
              </section>
            </aside>
          </main>

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
      ) : page === 'Trip History' ? (
        <main className="simple-page panel">
          <h2>Trip History</h2>
          <p className="muted">Choose a recorded trip and run its sensor simulation.</p>
          <div className="history-list">
            {trips.map((trip) => (
              <button
                key={trip.trip_id}
                onClick={async () => {
                  setPage('Dashboard')
                  await loadTrip(trip.trip_id)
                }}
              >
                <span>
                  <strong>{trip.trip_id}</strong>
                  <small>{trip.truck_id} · {trip.material_type}</small>
                </span>
                <span>{Number(trip.payload_kg).toLocaleString()} kg <ChevronRight size={15} /></span>
              </button>
            ))}
          </div>
        </main>
      ) : (
        <main className="simple-page panel">
          <h2>Settings</h2>
          <p className="muted">CARRYX simulation configuration</p>
          <div className="setting-row"><span>Backend API</span><code>http://127.0.0.1:8000</code></div>
          <div className="setting-row"><span>Sensor data</span><strong>Recorded simulated sensor data</strong></div>
          <div className="setting-row"><span>Trip model</span><strong>Existing saved Random Forest model</strong></div>
          <div className="setting-row"><span>Zone map</span><strong>Relative sensor-change scores</strong></div>
          <div className="setting-row"><span>Physical hardware</span><strong>Not connected — simulation only</strong></div>
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
