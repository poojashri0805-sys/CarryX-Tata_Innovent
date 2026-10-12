import axios from 'axios'

const api = axios.create({
  baseURL: 'http://127.0.0.1:8000',
  timeout: 15000,
})

export const getHealth = async () =>
  (await api.get('/health')).data

export const getTrips = async () =>
  (await api.get('/trips')).data

export const getPrediction = async (tripId) =>
  (await api.get(`/predict/${encodeURIComponent(tripId)}`)).data

export const getTripZones = async (tripId) =>
  (await api.get(`/zones/${encodeURIComponent(tripId)}`)).data

export const getSensorSummary = async (tripId) =>
  (await api.get(`/sensor-replay/${encodeURIComponent(tripId)}/summary`)).data

export const getSensorRecords = async (tripId, offset = 0, limit = 20) =>
  (
    await api.get(`/sensor-replay/${encodeURIComponent(tripId)}`, {
      params: { offset, limit },
    })
  ).data