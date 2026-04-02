import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from '../../api/client'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  }
}

beforeEach(() => { mockFetch.mockReset() })

describe('api.getStatus', () => {
  it('calls GET /api/status', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ running: false }))
    const result = await api.getStatus()
    expect(mockFetch).toHaveBeenCalledWith('/api/status', expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(result).toEqual({ running: false })
  })
})

describe('api.start', () => {
  it('calls POST /api/start with speeds', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}))
    await api.start(1000, 500)
    expect(mockFetch).toHaveBeenCalledWith('/api/start', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ downloadMbps: 1000, uploadMbps: 500 }),
    }))
  })
})

describe('api.stop', () => {
  it('calls POST /api/stop', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}))
    await api.stop()
    expect(mockFetch).toHaveBeenCalledWith('/api/stop', expect.objectContaining({ method: 'POST' }))
  })
})

describe('api.getSchedules', () => {
  it('returns schedule array', async () => {
    const data = [{ id: 1, daysOfWeek: [1] }]
    mockFetch.mockResolvedValueOnce(mockResponse(data))
    const result = await api.getSchedules()
    expect(result).toEqual(data)
  })
})

describe('api.getSettings', () => {
  it('returns settings', async () => {
    const data = { uploadMode: 'http', autoMode: 'reliable' }
    mockFetch.mockResolvedValueOnce(mockResponse(data))
    const result = await api.getSettings()
    expect(result).toEqual(data)
  })
})

describe('api.updateSettings', () => {
  it('calls PUT /api/settings', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}))
    await api.updateSettings({ defaultDownloadMbps: 5000 })
    expect(mockFetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ defaultDownloadMbps: 5000 }),
    }))
  })
})

describe('error handling', () => {
  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ error: 'bad' }, 400))
    await expect(api.getStatus()).rejects.toThrow('400')
  })
})

describe('api.unblockServer', () => {
  it('sends POST with url', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 'ok' }))
    await api.unblockServer('http://server1.test')
    expect(mockFetch).toHaveBeenCalledWith('/api/server-unblock', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ url: 'http://server1.test' }),
    }))
  })
})
