import { useState, useEffect, useCallback } from 'react'
import { getStorage } from '../lib/storage'
import { useAuth } from '../contexts/AuthContext'
import { ClientBag, ClientDisc } from '../utils/disc'
import type { BagHistoryEntry } from '../lib/storage/types'

export type { BagHistoryEntry }

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
    const data = await getStorage().bags.list()
    setBags(data)
  }, [user])

  useEffect(() => {
    loadBags()
  }, [loadBags])

  const recordHistory = async (
    bagId: string,
    discId: string,
    discName: string,
    action: 'added' | 'removed'
  ) => {
    await getStorage().bagHistory.add({
      bagId,
      discId,
      discName,
      action,
      userId: user?.id,
    })
  }

  const createBag = async (name: string) => {
    if (!user) return
    const newBag: ClientBag = {
      id: crypto.randomUUID(),
      name,
      disc_ids: [],
    }
    setBags(prev => [...prev, newBag])
    await getStorage().bags.create(newBag, user.id)
  }

  const renameBag = async (id: string, name: string) => {
    setBags(prev => prev.map(b => (b.id === id ? { ...b, name } : b)))
    await getStorage().bags.update(id, { name })
  }

  const deleteBag = async (id: string) => {
    setBags(prev => prev.filter(b => b.id !== id))
    await getStorage().bags.remove(id)
  }

  const toggleDiscInBag = async (
    bagId: string,
    discId: string,
    discs: ClientDisc[]
  ) => {
    const bag = bags.find(b => b.id === bagId)
    if (!bag) return
    const disc = discs.find(d => d.id === discId)
    const discName = disc?.name || 'Unknown'
    const alreadyIn = bag.disc_ids.includes(discId)
    const newIds = alreadyIn
      ? bag.disc_ids.filter(id => id !== discId)
      : [...bag.disc_ids, discId]
    setBags(prev => prev.map(b => (b.id === bagId ? { ...b, disc_ids: newIds } : b)))
    await getStorage().bags.update(bagId, { disc_ids: newIds })
    await recordHistory(bagId, discId, discName, alreadyIn ? 'removed' : 'added')
  }

  const removeDiscFromBag = async (bagId: string, discId: string, discName: string) => {
    const bag = bags.find(b => b.id === bagId)
    if (!bag) return
    const newIds = bag.disc_ids.filter(id => id !== discId)
    setBags(prev => prev.map(b => (b.id === bagId ? { ...b, disc_ids: newIds } : b)))
    await getStorage().bags.update(bagId, { disc_ids: newIds })
    await recordHistory(bagId, discId, discName, 'removed')
  }

  const loadBagHistory = async (bagId: string): Promise<BagHistoryEntry[]> => {
    return getStorage().bagHistory.listForBag(bagId)
  }

  return {
    bags,
    createBag,
    renameBag,
    deleteBag,
    toggleDiscInBag,
    removeDiscFromBag,
    loadBagHistory,
  }
}
