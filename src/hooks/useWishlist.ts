import { useState, useEffect, useCallback } from 'react'
import { createRow, deleteRows, listRows, updateRow } from '../lib/data'
import { useAuth } from '../contexts/AuthContext'

export interface WishlistItem {
  id: string
  disc_name: string
  manufacturer: string
  plastic_pref: string
  weight_min: number | null
  weight_max: number | null
  priority: number
  notes: string
  acquired: boolean
  created_at: string
}

export function useWishlist() {
  const { user } = useAuth()
  const [items, setItems] = useState<WishlistItem[]>([])

  const loadWishlist = useCallback(async () => {
    if (!user) return
    const data = await listRows<WishlistItem>('wishlist_items')
    setItems(
      (data || []).map(w => ({
        id: w.id,
        disc_name: w.disc_name || '',
        manufacturer: w.manufacturer || '',
        plastic_pref: w.plastic_pref || '',
        weight_min: w.weight_min,
        weight_max: w.weight_max,
        priority: w.priority ?? 0,
        notes: w.notes || '',
        acquired: w.acquired ?? false,
        created_at: w.created_at,
      }))
    )
  }, [user])

  useEffect(() => {
    void loadWishlist().catch(console.error)
  }, [loadWishlist])

  const addItem = async (item: Omit<WishlistItem, 'id' | 'created_at' | 'acquired'>) => {
    if (!user) return
    await createRow('wishlist_items', {
      disc_name: item.disc_name,
      manufacturer: item.manufacturer,
      plastic_pref: item.plastic_pref,
      weight_min: item.weight_min,
      weight_max: item.weight_max,
      priority: item.priority,
      notes: item.notes,
      acquired: false,
    })
    await loadWishlist()
  }

  const updateItem = async (id: string, updates: Partial<WishlistItem>) => {
    const { id: _id, created_at: _created, ...fields } = updates
    await updateRow('wishlist_items', id, fields)
    await loadWishlist()
  }

  const deleteItem = async (id: string) => {
    await deleteRows('wishlist_items', id)
    await loadWishlist()
  }

  const toggleAcquired = async (id: string, acquired: boolean) => {
    await updateRow('wishlist_items', id, { acquired })
    await loadWishlist()
  }

  return {
    items,
    loadWishlist,
    addItem,
    updateItem,
    deleteItem,
    toggleAcquired,
  }
}
