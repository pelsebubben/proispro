import { useState, useEffect, useCallback } from 'react'
import { createRow, deleteRows, listRows, subscribeToChanges, updateRow } from '../lib/data'
import { useAuth } from '../contexts/AuthContext'
import { ClientBag, ClientDisc } from '../utils/disc'

interface BagHistoryEntry {
  id: string
  bag_id: string
  disc_id: string
  disc_name: string
  action: 'added' | 'removed'
  changed_at: string
}

export function formatHistoryTime(ts: string): string {
  const diffMs = Date.now() - new Date(ts).getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(ts).toLocaleDateString()
}

export function useBags() {
  const { user } = useAuth()
  const [bags, setBags] = useState<ClientBag[]>([])

  const loadBags = useCallback(async () => {
    if (!user) return
    const data = await listRows<ClientBag>('bags')
    setBags(
      (data || []).map(b => ({
        id: b.id,
        name: b.name || '',
        disc_ids: Array.isArray(b.disc_ids) ? b.disc_ids : [],
      }))
    )
  }, [user])

  useEffect(() => {
    void loadBags().catch(console.error)
    return subscribeToChanges(['bags', 'discs'], loadBags)
  }, [loadBags])

  const createBag = async (name: string) => {
    if (!user) return
    const newBag: ClientBag = {
      id: crypto.randomUUID(),
      name,
      disc_ids: [],
    }
    await createRow('bags', {
      id: newBag.id,
      name: newBag.name,
      disc_ids: [],
    })
    setBags(prev => [...prev, newBag])
  }

  const renameBag = async (id: string, name: string) => {
    await updateRow('bags', id, { name })
    setBags(prev => prev.map(b => (b.id === id ? { ...b, name } : b)))
  }

  const deleteBag = async (id: string) => {
    await deleteRows('bags', id)
    setBags(prev => prev.filter(b => b.id !== id))
  }

  const toggleDiscInBag = async (
    bagId: string,
    discId: string,
    discs: ClientDisc[]
  ) => {
    const bag = bags.find(b => b.id === bagId)
    if (!bag) return
    if (!discs.some(d => d.id === discId)) throw new Error('Disc not found')
    const alreadyIn = bag.disc_ids.includes(discId)
    const newIds = alreadyIn
      ? bag.disc_ids.filter(id => id !== discId)
      : [...bag.disc_ids, discId]
    await updateRow('bags', bagId, { disc_ids: newIds })
    setBags(prev => prev.map(b => (b.id === bagId ? { ...b, disc_ids: newIds } : b)))
  }

  const removeDiscFromBag = async (bagId: string, discId: string, _discName: string) => {
    const bag = bags.find(b => b.id === bagId)
    if (!bag) return
    const newIds = bag.disc_ids.filter(id => id !== discId)
    await updateRow('bags', bagId, { disc_ids: newIds })
    setBags(prev => prev.map(b => (b.id === bagId ? { ...b, disc_ids: newIds } : b)))
  }

  const loadBagHistory = async (bagId: string): Promise<BagHistoryEntry[]> => {
    return listRows<BagHistoryEntry>('bag_history', { bag_id: bagId })
  }

  return {
    bags,
    loadBags,
    createBag,
    renameBag,
    deleteBag,
    toggleDiscInBag,
    removeDiscFromBag,
    loadBagHistory,
  }
}
