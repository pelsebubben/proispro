import { useState, useEffect, useCallback } from 'react'
import { getStorage } from '../lib/storage'
import { useAuth } from '../contexts/AuthContext'
import { ClientDisc } from '../utils/disc'

export function useDiscs() {
  const { user } = useAuth()
  const [discs, setDiscs] = useState<ClientDisc[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDiscs = useCallback(async () => {
    if (!user) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await getStorage().discs.list()
      setDiscs(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load discs')
    } finally {
      setIsLoading(false)
    }
  }, [user])

  useEffect(() => {
    loadDiscs()
  }, [loadDiscs])

  const saveDisc = async (
    disc: Omit<ClientDisc, 'id'> & { id?: string }
  ): Promise<ClientDisc | null> => {
    if (!user) return null
    try {
      if (disc.id) {
        // Update
        const updated = disc as ClientDisc
        await getStorage().discs.update(updated)
        setDiscs(prev => prev.map(d => (d.id === disc.id ? updated : d)))
        return updated
      } else {
        // Insert
        const newId = crypto.randomUUID()
        const newDisc = { ...disc, id: newId, added: Date.now() } as ClientDisc
        const saved = await getStorage().discs.create(newDisc, user.id)
        setDiscs(prev => [saved, ...prev])
        return saved
      }
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  const deleteDisc = async (id: string) => {
    await getStorage().discs.remove(id)
    setDiscs(prev => prev.filter(d => d.id !== id))
  }

  const setDiscQty = async (id: string, qty: number) => {
    const safeQty = Math.max(1, qty)
    setDiscs(prev => prev.map(d => (d.id === id ? { ...d, quantity: safeQty } : d)))
    try {
      await getStorage().discs.setQuantity(id, safeQty)
    } catch (err) {
      // Revert optimistic update
      setDiscs(prev => prev.map(d => (d.id === id ? { ...d, quantity: d.quantity } : d)))
      throw err
    }
  }

  return { discs, isLoading, error, loadDiscs, saveDisc, deleteDisc, setDiscQty }
}
