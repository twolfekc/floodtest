import { useState, useEffect, useCallback } from 'react'
import { api, Schedule } from '../api/client'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatDays(days: number[]): string {
  if (days.length === 7) return 'Every day'
  if (
    days.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => days.includes(d))
  ) {
    return 'Weekdays'
  }
  if (
    days.length === 2 &&
    days.includes(0) &&
    days.includes(6)
  ) {
    return 'Weekends'
  }
  return days
    .sort((a, b) => a - b)
    .map((d) => DAY_NAMES[d])
    .join(', ')
}

function formatSpeed(mbps: number): string {
  if (mbps >= 1000) {
    return `${(mbps / 1000).toFixed(1)} Gbps`
  }
  return `${mbps} Mbps`
}

const emptyForm: Schedule = {
  daysOfWeek: [],
  startTime: '09:00',
  endTime: '17:00',
  downloadMbps: 500,
  uploadMbps: 500,
  enabled: true,
}

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<Schedule>({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const loadSchedules = useCallback(async () => {
    try {
      const data = await api.getSchedules()
      setSchedules(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSchedules()
  }, [loadSchedules])

  const openAddForm = () => {
    setForm({ ...emptyForm })
    setEditingId(null)
    setShowForm(true)
  }

  const openEditForm = (schedule: Schedule) => {
    setForm({ ...schedule })
    setEditingId(schedule.id ?? null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
  }

  const toggleDay = (day: number) => {
    setForm((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter((d) => d !== day)
        : [...prev.daysOfWeek, day],
    }))
  }

  const handleSave = async () => {
    if (form.daysOfWeek.length === 0) {
      alert('Please select at least one day.')
      return
    }
    setSaving(true)
    try {
      if (editingId !== null) {
        await api.updateSchedule({ ...form, id: editingId })
      } else {
        await api.createSchedule(form)
      }
      closeForm()
      await loadSchedules()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save schedule')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this schedule entry?')) return
    try {
      await api.deleteSchedule(id)
      await loadSchedules()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete schedule')
    }
  }

  const handleToggleEnabled = async (schedule: Schedule) => {
    try {
      await api.updateSchedule({ ...schedule, enabled: !schedule.enabled })
      await loadSchedules()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update schedule')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-gray-400">Loading schedules...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-red-400">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Schedules</h2>
        <button
          onClick={openAddForm}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors"
        >
          Add Schedule
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-4">
          <h3 className="text-lg font-semibold text-white">
            {editingId !== null ? 'Edit Schedule' : 'New Schedule'}
          </h3>

          {/* Days of week */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Days of Week</label>
            <div className="flex gap-2">
              {DAY_NAMES.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors ${
                    form.daysOfWeek.includes(i)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Start Time</label>
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm((prev) => ({ ...prev, startTime: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">End Time</label>
              <input
                type="time"
                value={form.endTime}
                onChange={(e) => setForm((prev) => ({ ...prev, endTime: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Speed targets */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Download Speed (Mbps)</label>
              <input
                type="number"
                min={1}
                value={form.downloadMbps}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    downloadMbps: parseInt(e.target.value) || 0,
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Upload Speed (Mbps)</label>
              <input
                type="number"
                min={1}
                value={form.uploadMbps}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    uploadMbps: parseInt(e.target.value) || 0,
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={closeForm}
              className="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {schedules.length === 0 && !showForm ? (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
          <p className="text-gray-400 mb-2">No schedules configured</p>
          <p className="text-gray-500 text-sm">
            Add a schedule to automatically adjust bandwidth targets at specific times.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((schedule) => (
            <div
              key={schedule.id}
              className={`bg-gray-900 rounded-xl border border-gray-800 p-4 ${
                !schedule.enabled ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="text-white font-medium">
                      {formatDays(schedule.daysOfWeek)}
                    </span>
                    <span className="text-gray-400 text-sm">
                      {schedule.startTime} - {schedule.endTime}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-green-400">
                      DL: {formatSpeed(schedule.downloadMbps)}
                    </span>
                    <span className="text-blue-400">
                      UL: {formatSpeed(schedule.uploadMbps)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Enable/Disable toggle */}
                  <button
                    onClick={() => handleToggleEnabled(schedule)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      schedule.enabled ? 'bg-blue-600' : 'bg-gray-700'
                    }`}
                    title={schedule.enabled ? 'Disable' : 'Enable'}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                        schedule.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>

                  <button
                    onClick={() => openEditForm(schedule)}
                    className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => schedule.id !== undefined && handleDelete(schedule.id)}
                    className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
