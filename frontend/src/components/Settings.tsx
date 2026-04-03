import { useState, useEffect } from 'react'
import { api, Settings as SettingsType } from '../api/client'
import {
  Cloud, Gauge, Layers, Server, Shield, Plus, X,
  CheckCircle, AlertCircle, Loader2, Save, Plug,
} from 'lucide-react'

export default function Settings() {
  const [settings, setSettings] = useState<SettingsType | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [newServerUrl, setNewServerUrl] = useState('')
  const [newUploadEndpoint, setNewUploadEndpoint] = useState('')

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const update = (partial: Partial<SettingsType>) => {
    if (!settings) return
    setSettings({ ...settings, ...partial })
  }

  const handleTestConnection = async () => {
    setTestStatus('testing')
    setTestMessage('')
    try {
      // Save current B2 settings before testing
      if (settings) {
        await api.updateSettings({
          b2KeyId: settings.b2KeyId,
          b2AppKey: settings.b2AppKey,
          b2BucketName: settings.b2BucketName,
          b2Endpoint: settings.b2Endpoint,
        })
      }
      const result = await api.testB2()
      if (result.success) {
        setTestStatus('success')
        setTestMessage(result.message || 'Connection successful')
      } else {
        setTestStatus('error')
        setTestMessage(result.message || 'Connection failed')
      }
    } catch (err) {
      setTestStatus('error')
      setTestMessage(err instanceof Error ? err.message : 'Connection failed')
    }
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    setSaveMessage('')
    try {
      await api.updateSettings(settings)
      setSaveMessage('Settings saved successfully')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (err) {
      setSaveMessage(
        `Error: ${err instanceof Error ? err.message : 'Failed to save'}`
      )
    } finally {
      setSaving(false)
    }
  }

  const addServer = () => {
    if (!settings || !newServerUrl.trim()) return
    update({
      downloadServers: [...settings.downloadServers, newServerUrl.trim()],
    })
    setNewServerUrl('')
  }

  const removeServer = (index: number) => {
    if (!settings) return
    update({
      downloadServers: settings.downloadServers.filter((_, i) => i !== index),
    })
  }

  const addUploadEndpoint = () => {
    if (!settings || !newUploadEndpoint.trim()) return
    update({ uploadEndpoints: [...settings.uploadEndpoints, newUploadEndpoint.trim()] })
    setNewUploadEndpoint('')
  }

  const removeUploadEndpoint = (index: number) => {
    if (!settings) return
    update({ uploadEndpoints: settings.uploadEndpoints.filter((_, i) => i !== index) })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="text-zinc-500 animate-spin mr-2" />
        <span className="text-zinc-400">Loading settings...</span>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-20">
        <AlertCircle size={16} className="text-red-400 mr-2" />
        <span className="text-red-400">Failed to load settings</span>
      </div>
    )
  }

  const inputClass =
    'w-full px-3 py-2 bg-forge-raised border border-white/[0.06] rounded-lg text-zinc-50 text-sm placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/30 transition-colors'
  const labelClass = 'block text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1.5'

  const uploadModes = [
    { value: 'http', label: 'HTTP Discard', desc: 'Free' },
    { value: 's3', label: 'S3-Compatible', desc: 'B2 / R2' },
    { value: 'local', label: 'Local Discard', desc: 'Testing' },
  ]

  return (
    <div className="max-w-[1400px] space-y-6">
      {/* Page Header */}
      <div className="animate-fade-in">
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Engine configuration</p>
      </div>

      {/* Upload Configuration */}
      <div className="animate-fade-in-up stagger-1 bg-forge-surface rounded-xl border border-forge-border p-5">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Cloud size={14} className="text-blue-400" />
          </div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Upload Configuration</h3>
        </div>

        {/* Upload Mode selector — segmented control */}
        <div className="mb-5">
          <label className={labelClass}>Upload Mode</label>
          <div className="flex rounded-lg bg-forge-raised border border-white/[0.06] p-0.5 gap-0.5">
            {uploadModes.map((mode) => (
              <button
                key={mode.value}
                onClick={() => update({ uploadMode: mode.value })}
                className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                  settings.uploadMode === mode.value
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                }`}
              >
                <span className="block">{mode.label}</span>
                <span className="block text-[10px] mt-0.5 opacity-60">{mode.desc}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-600 mt-2">
            {settings.uploadMode === 'http' && 'Uploads random data to HTTP discard endpoints. No account required \u2014 measures real WAN upload throughput.'}
            {settings.uploadMode === 's3' && 'Uploads to an S3-compatible bucket (e.g. Backblaze B2, Cloudflare R2). Requires credentials below.'}
            {settings.uploadMode === 'local' && 'Uploads to this app\u0027s built-in discard endpoint. Does not measure real WAN bandwidth.'}
          </p>
        </div>

        {/* S3 mode: B2 credential fields */}
        {settings.uploadMode === 's3' && (
          <div className="mb-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Key ID</label>
                <input
                  type="text"
                  value={settings.b2KeyId}
                  onChange={(e) => update({ b2KeyId: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Application Key</label>
                <input
                  type="password"
                  value={settings.b2AppKey}
                  onChange={(e) => update({ b2AppKey: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Bucket Name</label>
                <input
                  type="text"
                  value={settings.b2BucketName}
                  onChange={(e) => update({ b2BucketName: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>S3 Endpoint</label>
                <p className="text-xs text-zinc-600 mb-2">Must match your B2 account. Check your B2 dashboard &rarr; Buckets &rarr; Endpoint column.</p>
                {(() => {
                  const knownEndpoints = [
                    'https://s3.us-west-000.backblazeb2.com',
                    'https://s3.us-west-001.backblazeb2.com',
                    'https://s3.us-west-002.backblazeb2.com',
                    'https://s3.us-west-004.backblazeb2.com',
                    'https://s3.us-east-005.backblazeb2.com',
                  ]
                  const isKnown = knownEndpoints.includes(settings.b2Endpoint)
                  return (
                    <div className="space-y-2">
                      <select
                        value={isKnown ? settings.b2Endpoint : '__custom__'}
                        onChange={(e) => {
                          if (e.target.value !== '__custom__') {
                            update({ b2Endpoint: e.target.value })
                          } else {
                            update({ b2Endpoint: '' })
                          }
                        }}
                        className={inputClass}
                      >
                        <option value="https://s3.us-west-000.backblazeb2.com">us-west-000 &mdash; s3.us-west-000.backblazeb2.com</option>
                        <option value="https://s3.us-west-001.backblazeb2.com">us-west-001 &mdash; s3.us-west-001.backblazeb2.com</option>
                        <option value="https://s3.us-west-002.backblazeb2.com">us-west-002 &mdash; s3.us-west-002.backblazeb2.com</option>
                        <option value="https://s3.us-west-004.backblazeb2.com">us-west-004 &mdash; s3.us-west-004.backblazeb2.com</option>
                        <option value="https://s3.us-east-005.backblazeb2.com">us-east-005 &mdash; s3.us-east-005.backblazeb2.com</option>
                        <option value="__custom__">Custom endpoint...</option>
                      </select>
                      {!isKnown && (
                        <input
                          type="text"
                          value={settings.b2Endpoint}
                          onChange={(e) => update({ b2Endpoint: e.target.value })}
                          placeholder="https://s3.xx-xxxx-xxx.backblazeb2.com"
                          className={inputClass}
                        />
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={handleTestConnection}
                disabled={testStatus === 'testing'}
                className="inline-flex items-center gap-2 px-4 py-2 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 bg-transparent text-sm font-medium rounded-lg transition-all disabled:opacity-50"
              >
                {testStatus === 'testing' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plug size={14} />
                )}
                {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
              </button>
              {testStatus === 'success' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-medium text-emerald-400">
                  <CheckCircle size={12} />
                  {testMessage}
                </span>
              )}
              {testStatus === 'error' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-xs font-medium text-red-400">
                  <AlertCircle size={12} />
                  {testMessage}
                </span>
              )}
            </div>
          </div>
        )}

        {/* HTTP mode: upload endpoints list */}
        {settings.uploadMode === 'http' && (
          <div className="mb-5">
            <label className={labelClass}>Upload Endpoints</label>
            <div className="space-y-2 mb-3">
              {settings.uploadEndpoints.length === 0 && (
                <p className="text-xs text-zinc-600 py-3 text-center border border-dashed border-forge-border-strong rounded-lg">No upload endpoints configured</p>
              )}
              {settings.uploadEndpoints.map((url, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 bg-forge-raised border border-white/[0.06] rounded-lg px-3 py-2.5 group"
                >
                  <div className="w-5 h-5 rounded-md bg-blue-500/10 flex items-center justify-center shrink-0">
                    <Cloud size={10} className="text-blue-400" />
                  </div>
                  <span className="flex-1 text-sm text-zinc-300 font-mono truncate">
                    {url}
                  </span>
                  <button
                    onClick={() => removeUploadEndpoint(index)}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                    aria-label={`Remove endpoint ${url}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newUploadEndpoint}
                onChange={(e) => setNewUploadEndpoint(e.target.value)}
                placeholder="https://example.com/upload"
                className={inputClass}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addUploadEndpoint()
                }}
              />
              <button
                onClick={addUploadEndpoint}
                disabled={!newUploadEndpoint.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-forge-raised border border-white/[0.06] hover:border-amber-500/30 hover:text-amber-400 text-zinc-400 text-sm font-medium rounded-lg transition-all disabled:opacity-40 shrink-0"
              >
                <Plus size={14} />
                Add
              </button>
            </div>
          </div>
        )}

        {/* Local mode: info box */}
        {settings.uploadMode === 'local' && (
          <div className="mb-5 bg-forge-raised border border-white/[0.06] rounded-lg p-4">
            <p className="text-sm text-zinc-400">
              Uploads to this app's built-in discard endpoint. Does not test real WAN upload bandwidth &mdash; only useful for testing the upload engine itself.
            </p>
          </div>
        )}

        {/* Chunk Size -- shown for all modes */}
        <div className="max-w-xs">
          <label className={labelClass}>Chunk Size (MB)</label>
          <input
            type="number"
            value={settings.uploadChunkSizeMb}
            onChange={(e) =>
              update({ uploadChunkSizeMb: Number(e.target.value) })
            }
            min={1}
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      {/* Speed Targets */}
      <div className="animate-fade-in-up stagger-2 bg-forge-surface rounded-xl border border-forge-border p-5">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Gauge size={14} className="text-amber-400" />
          </div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Speed Targets</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Download (Mbps)</label>
            <input
              type="number"
              value={settings.defaultDownloadMbps}
              onChange={(e) =>
                update({ defaultDownloadMbps: Number(e.target.value) })
              }
              min={1}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className={labelClass}>Upload (Mbps)</label>
            <input
              type="number"
              value={settings.defaultUploadMbps}
              onChange={(e) =>
                update({ defaultUploadMbps: Number(e.target.value) })
              }
              min={1}
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>
      </div>

      {/* Concurrency */}
      <div className="animate-fade-in-up stagger-3 bg-forge-surface rounded-xl border border-forge-border p-5">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
            <Layers size={14} className="text-violet-400" />
          </div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Concurrency</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Download Streams</label>
            <input
              type="number"
              value={settings.downloadConcurrency}
              onChange={(e) =>
                update({ downloadConcurrency: Number(e.target.value) })
              }
              min={1}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className={labelClass}>Upload Streams</label>
            <input
              type="number"
              value={settings.uploadConcurrency}
              onChange={(e) =>
                update({ uploadConcurrency: Number(e.target.value) })
              }
              min={1}
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>
      </div>

      {/* Download Servers */}
      <div className="animate-fade-in-up stagger-4 bg-forge-surface rounded-xl border border-forge-border p-5">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <Server size={14} className="text-emerald-400" />
          </div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Download Servers</h3>
        </div>
        <div className="space-y-2 mb-3">
          {settings.downloadServers.length === 0 && (
            <p className="text-xs text-zinc-600 py-3 text-center border border-dashed border-forge-border-strong rounded-lg">No download servers configured</p>
          )}
          {settings.downloadServers.map((url, index) => (
            <div
              key={index}
              className="flex items-center gap-2 bg-forge-raised border border-white/[0.06] rounded-lg px-3 py-2.5 group"
            >
              <div className="w-5 h-5 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Server size={10} className="text-emerald-400" />
              </div>
              <span className="flex-1 text-sm text-zinc-300 font-mono truncate">
                {url}
              </span>
              <button
                onClick={() => removeServer(index)}
                className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                aria-label={`Remove server ${url}`}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newServerUrl}
            onChange={(e) => setNewServerUrl(e.target.value)}
            placeholder="https://example.com/testfile"
            className={inputClass}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addServer()
            }}
          />
          <button
            onClick={addServer}
            disabled={!newServerUrl.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-forge-raised border border-white/[0.06] hover:border-amber-500/30 hover:text-amber-400 text-zinc-400 text-sm font-medium rounded-lg transition-all disabled:opacity-40 shrink-0"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
      </div>

      {/* Throttle Detection */}
      <div className="animate-fade-in-up stagger-5 bg-forge-surface rounded-xl border border-forge-border p-5">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center">
            <Shield size={14} className="text-rose-400" />
          </div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Throttle Detection</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Threshold (%)</label>
            <input
              type="number"
              value={settings.throttleThresholdPct}
              onChange={(e) =>
                update({ throttleThresholdPct: Number(e.target.value) })
              }
              min={1}
              max={100}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className={labelClass}>Detection Window (minutes)</label>
            <input
              type="number"
              value={settings.throttleWindowMin}
              onChange={(e) =>
                update({ throttleWindowMin: Number(e.target.value) })
              }
              min={1}
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>
      </div>

      {/* Save button row */}
      <div className="animate-fade-in-up stagger-6 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="relative inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold text-sm rounded-lg transition-all disabled:opacity-50 shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30"
        >
          {saving ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Save size={15} />
          )}
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        {saveMessage && (
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
              saveMessage.startsWith('Error')
                ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            }`}
          >
            {saveMessage.startsWith('Error') ? (
              <AlertCircle size={12} />
            ) : (
              <CheckCircle size={12} />
            )}
            {saveMessage}
          </span>
        )}
      </div>
    </div>
  )
}
