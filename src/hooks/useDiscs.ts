import { useState, useEffect, useCallback } from 'react'
import { createRow, deleteRows, listRows, subscribeToChanges, updateRow } from '../lib/data'
import { useAuth } from '../contexts/AuthContext'
import { ClientDisc, fromDbDisc, toDbDisc } from '../utils/disc'

export function useDiscs() {
  const { user } = useAuth()
  const [discs, setDiscs] = useState<ClientDisc[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDiscs = useCallback(async () => {
    if (!user) { setDiscs([]); return }
    setIsLoading(true)
    setError(null)
    try {
      setDiscs((await listRows<Record<string, unknown>>('discs')).map(fromDbDisc))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load discs')
    } finally {
      setIsLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadDiscs()
    return subscribeToChanges(['discs'], loadDiscs)
  }, [loadDiscs])

  const saveDisc = async (disc: Omit<ClientDisc, 'id'> & { id?: string }): Promise<ClientDisc | null> => {
    if (!user) return null
    const newDisc: ClientDisc = { ...disc, id: disc.id ?? crypto.randomUUID() }
    const { id, ...fields } = toDbDisc(newDisc)
    const row = disc.id
      ? await updateRow<Record<string, unknown>>('discs', id, fields)
      : await createRow<Record<string, unknown>>('discs', { ...fields, id })
    const saved = fromDbDisc(row)
    setDiscs(prev => disc.id ? prev.map(d => d.id === saved.id ? saved : d) : [saved, ...prev])
    return saved
  }

  const deleteDisc = async (id: string) => {
    await deleteRows('discs', id)
    setDiscs(prev => prev.filter(d => d.id !== id))
  }

  const setDiscQty = async (id: string, qty: number) => {
    const safeQty = Math.max(1, qty)
    await updateRow('discs', id, { quantity: safeQty })
    setDiscs(prev => prev.map(d => d.id === id ? { ...d, quantity: safeQty } : d))
  }

  return { discs, isLoading, error, loadDiscs, saveDisc, deleteDisc, setDiscQty }
}
