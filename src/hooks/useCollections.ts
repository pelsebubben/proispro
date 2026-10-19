import { useState, useEffect, useCallback } from 'react'
import { getStorage } from '../lib/storage'
import { useAuth } from '../contexts/AuthContext'
import { ClientDisc } from '../utils/disc'
import type { ClientCollection, CollectionDisc } from '../lib/storage/types'

export type { ClientCollection, CollectionDisc }

export function useCollections() {
  const { user } = useAuth()
  const [collections, setCollections] = useState<ClientCollection[]>([])
  const [collectionDiscs, setCollectionDiscs] = useState<CollectionDisc[]>([])

  const loadCollections = useCallback(async () => {
    if (!user) return
    const [colData, cdData] = await Promise.all([
      getStorage().collections.list(),
      getStorage().collectionDiscs.list(),
    ])
    setCollections(colData)
    setCollectionDiscs(cdData)
  }, [user])

  useEffect(() => {
    loadCollections()
  }, [loadCollections])

  const createCollection = async (name: string, description: string) => {
    if (!user) return
    await getStorage().collections.create({ name, description })
    await loadCollections()
  }

  const updateCollection = async (id: string, name: string, description: string) => {
    await getStorage().collections.update(id, { name, description })
    await loadCollections()
  }

  const deleteCollection = async (id: string) => {
    await getStorage().collectionDiscs.removeByCollection(id)
    await getStorage().collections.remove(id)
    await loadCollections()
  }

  const toggleDiscInCollection = async (collectionId: string, discId: string) => {
    const existing = collectionDiscs.find(
      cd => cd.collection_id === collectionId && cd.disc_id === discId
    )
    if (existing) {
      await getStorage().collectionDiscs.remove(collectionId, discId)
    } else {
      await getStorage().collectionDiscs.add(collectionId, discId)
    }
    await loadCollections()
  }

  const isDiscInCollection = (collectionId: string, discId: string): boolean => {
    return collectionDiscs.some(cd => cd.collection_id === collectionId && cd.disc_id === discId)
  }

  const getDiscsForCollection = (collection: ClientCollection, allDiscs: ClientDisc[]): ClientDisc[] => {
    const discIds = collectionDiscs
      .filter(cd => cd.collection_id === collection.id)
      .map(cd => cd.disc_id)
    return allDiscs.filter(d => discIds.includes(d.id))
  }

  return {
    collections,
    collectionDiscs,
    loadCollections,
    createCollection,
    updateCollection,
    deleteCollection,
    toggleDiscInCollection,
    isDiscInCollection,
    getDiscsForCollection,
  }
}
