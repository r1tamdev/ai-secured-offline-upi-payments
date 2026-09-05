import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { encryptPacket } from '../utils/clientCrypto'
import { generateQR } from '../utils/qr'
import { sharePacketViaNearby } from '../utils/blePeripheral'
import api from '../utils/api'

const uuid = () => crypto.randomUUID()
const POLL_MS = 3000

export default function PayPage() {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()

  const [step, setStep]           = useState('form')
  const [users, setUsers]         = useState([])
  const [form, setForm]           = useState({ receiver: '', amount: '', note: '' })
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [settlement, setSettlement] = useState(null)
  const [bleStatus, setBleStatus] = useState('')
  const pollRef  = useRef(null)
  const formRef  = useRef(form)   // keep latest form values inside interval

  // keep formRef in sync with form state
  useEffect(() => { formRef.current = form }, [form])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    api.get('/account/users').then((r) => setUsers(r.data)).catch(() => {})
  }, [])

  // ── Poll payment history when QR is showing ──────────────────────────────
  // Works across different devices because it hits the server directly —
  // no sessionStorage sync needed between payer and relay phones.
  useEffect(() => {
    if (step !== 'qr') {
      clearInterval(pollRef.current)
      return
    }

    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get('/payment/history')
        const payments = res.data

        if (!payments || payments.length === 0) return

        const { receiver, amount } = formRef.current
        const now = Date.now()

        // Find a matching settled payment created within the last 2 minutes
        const match = payments.find((p) =>
          p.sender   === user.upiId &&
          p.receiver === receiver &&
          p.amount   === parseFloat(amount) &&
          p.status   === 'SETTLED' &&
          now - new Date(p.settledAt).getTime() < 2 * 60 * 1000
        )

        if (match) {
          clearInterval(pollRef.current)
          setSettlement(match)
          setStep('success')
          refreshUser().catch(() => {})
        }
      } catch {
        // server unreachable — keep polling
      }
    }, POLL_MS)

    return () => clearInterval(pollRef.current)
  }, [step, user])

  // ── Create encrypted packet + QR ─────────────────────────────────────────
  async function handleCreatePacket(e) {
    e.preventDefault()
    setError('')
    if (form.receiver === user.upiId) return setError("Can't pay yourself")
    setLoading(true)
    try {
      const { data: { publicKey } } = await api.get('/auth/pubkey')

      const instruction = {
        nonce:    uuid(),
        sender:   user.upiId,
        receiver: form.receiver,
        amount:   parseFloat(form.amount),
        note:     form.note,
        signedAt: Date.now(),
      }

      const packetB64 = await encryptPacket(instruction, publicKey)
      sessionStorage.setItem('pendingPacket', packetB64)

      const qr = await generateQR(packetB64)
      setQrDataUrl(qr)
      setStep('qr')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Bluetooth share ───────────────────────────────────────────────────────
  async function handleBluetoothShare() {
    setBleStatus('')
    try {
      const packetB64 = sessionStorage.getItem('pendingPacket')
      if (!packetB64) { setBleStatus('No packet found. Create one first.'); return }
      await sharePacketViaNearby(packetB64, setBleStatus)
    } catch (err) {
      setBleStatus(`Bluetooth: ${err.message}`)
    }
  }

  // ── Success screen ────────────────────────────────────────────────────────
  if (step === 'success') return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 text-center gap-4">
      <div className="text-6xl">✅</div>
      <h1 className="text-2xl font-bold text-green-600">Payment sent!</h1>
      <p className="text-gray-600">₹{settlement?.amount} → {settlement?.receiver}</p>
      <p className="text-xs text-gray-400">
        Settled at {new Date(settlement?.settledAt).toLocaleTimeString()}
      </p>
      <p className="text-xs text-gray-400">
        Relayed by {settlement?.relayedBy}
      </p>
      <button
        onClick={() => navigate('/')}
        className="bg-green-600 text-white font-semibold px-6 py-3 rounded-xl"
      >
        Back home
      </button>
    </div>
  )

  // ── Failed screen ─────────────────────────────────────────────────────────
  if (step === 'failed') return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 text-center gap-4">
      <div className="text-6xl">❌</div>
      <h1 className="text-2xl font-bold text-red-500">Payment failed</h1>
      <p className="text-gray-600">{settlement?.message || 'Unknown error'}</p>
      <button
        onClick={() => setStep('form')}
        className="border border-gray-200 px-6 py-3 rounded-xl font-semibold"
      >
        Try again
      </button>
    </div>
  )

  // ── QR screen ─────────────────────────────────────────────────────────────
  if (step === 'qr') return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-sm mx-auto p-4 space-y-4">
        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={() => { clearInterval(pollRef.current); setStep('form') }}
            className="text-sm border border-gray-200 px-3 py-1.5 rounded-lg"
          >
            ← Back
          </button>
          <h2 className="font-bold text-gray-900">Share with relay</h2>
        </div>

        {/* QR Code */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500 mb-4">
            Ask someone with internet to scan this and tap Upload
          </p>
          {qrDataUrl && (
            <img src={qrDataUrl} alt="Payment QR" className="w-64 h-64 mx-auto rounded-xl" />
          )}
          <div className="mt-4 bg-gray-50 rounded-xl p-3">
            <div className="font-bold text-xl">₹{form.amount}</div>
            <div className="text-xs text-gray-400">{user?.upiId} → {form.receiver}</div>
          </div>
        </div>

        {/* Bluetooth share */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 text-center">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Or send via Bluetooth
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Share the encrypted packet directly with the relay person nearby
          </p>
          <button
            onClick={handleBluetoothShare}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            📲 Share packet via Bluetooth
          </button>
          {bleStatus && (
            <div className="mt-3 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg">
              {bleStatus}
            </div>
          )}
        </div>

        {/* Waiting indicator */}
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="font-semibold text-blue-700 text-sm">Waiting for relay…</span>
          </div>
          <p className="text-xs text-blue-600">
            Your screen will update automatically once settled
          </p>
        </div>
      </div>
    </div>
  )

  // ── Form screen ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-sm mx-auto p-4 space-y-4">
        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={() => navigate('/')}
            className="text-sm border border-gray-200 px-3 py-1.5 rounded-lg"
          >
            ← Back
          </button>
          <h2 className="font-bold text-gray-900">Send payment</h2>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex justify-between text-sm mb-4">
            <span className="text-gray-400">From</span>
            <span className="font-semibold">{user?.upiId}</span>
          </div>
          <hr className="border-gray-100 mb-4" />

          <form onSubmit={handleCreatePacket} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Pay to</label>
              <select
                value={form.receiver}
                onChange={set('receiver')}
                required
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-500"
              >
                <option value="">Select receiver…</option>
                {users.filter((u) => u.upiId !== user?.upiId).map((u) => (
                  <option key={u.upiId} value={u.upiId}>
                    {u.name} ({u.upiId})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Amount (₹)</label>
              <input
                type="number"
                placeholder=""
                value={form.amount}
                onChange={set('amount')}
                min="1"
                max={user?.balance}
                required
                inputMode="decimal"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Note (optional)</label>
              <input
                placeholder=""
                value={form.note}
                onChange={set('note')}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-500"
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>
            )}

            <div className="bg-blue-50 text-blue-700 text-xs px-4 py-3 rounded-xl">
              💡 Your payment will be encrypted and turned into a QR. A stranger with internet will relay it.
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {loading ? 'Encrypting…' : '🔐 Create Payment QR'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}