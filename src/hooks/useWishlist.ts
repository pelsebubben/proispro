import { useState, useEffect, useCallback } from 'react'
import { getStorage } from '../lib/storage'
import { useAuth } from '../contexts/AuthContext'
import type { WishlistItem } from '../lib/storage/types'

export type { WishlistItem }

export function useWishlist() {
  const { user } = useAuth()
  const [items, setItems] = useState<WishlistItem[]>([])

  const loadWishlist = useCallback(async () => {
    if (!user) return
    const data = await getStorage().wishlist.list()
    setItems(data)
  }, [user])

  useEffect(() => {
    loadWishlist()
  }, [loadWishlist])

  const addItem = async (item: Omit<WishlistItem, 'id' | 'created_at' | 'acquired'>) => {
    if (!user) return
    await getStorage().wishlist.create(item)
    await loadWishlist()
  }

  const updateItem = async (id: string, updates: Partial<WishlistItem>) => {
    await getStorage().wishlist.update(id, updates)
    await loadWishlist()
  }

  const deleteItem = async (id: string) => {
    await getStorage().wishlist.remove(id)
    await loadWishlist()
  }

  const toggleAcquired = async (id: string, acquired: boolean) => {
    await getStorage().wishlist.update(id, { acquired })
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
