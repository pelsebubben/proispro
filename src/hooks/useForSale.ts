import { useState, useEffect, useCallback } from 'react'
import { getStorage } from '../lib/storage'
import { useAuth } from '../contexts/AuthContext'
import { ClientDisc } from '../utils/disc'
import type { ForSaleListing } from '../lib/storage/types'

export type { ForSaleListing }

export function useForSale() {
  const { user } = useAuth()
  const [listings, setListings] = useState<ForSaleListing[]>([])
  const [saleToken, setSaleToken] = useState<string>('')
  const [saleIsPublic, setSaleIsPublic] = useState<boolean>(false)

  const loadListings = useCallback(async () => {
    if (!user) return
    const data = await getStorage().forSale.list()
    setListings(data)
  }, [user])

  const loadSaleToken = useCallback(async () => {
    if (!user) return
    const data = await getStorage().saleTokens.getForUser(user.id)
    if (data) {
      setSaleToken(data.token)
      setSaleIsPublic(data.is_public)
    }
  }, [user])

  useEffect(() => {
    loadListings()
    loadSaleToken()
  }, [loadListings, loadSaleToken])

  const ensureSaleToken = async (): Promise<string> => {
    if (!user) return ''
    if (saleToken) return saleToken
    const newToken = crypto.randomUUID()
    await getStorage().saleTokens.upsert(user.id, newToken, false)
    setSaleToken(newToken)
    return newToken
  }

  const addListing = async (disc: ClientDisc) => {
    if (!user) return
    await getStorage().forSale.create(disc)
    await loadListings()
  }

  const deleteListing = async (id: string) => {
    await getStorage().forSale.remove(id)
    await loadListings()
  }

  const updateStatus = async (id: string, status: 'available' | 'sold') => {
    await getStorage().forSale.updateStatus(id, status)
    await loadListings()
  }

  const togglePublic = async () => {
    if (!user) return
    await ensureSaleToken()
    const newPublic = !saleIsPublic
    await getStorage().saleTokens.setPublic(user.id, newPublic)
    setSaleIsPublic(newPublic)
  }

  const copyPublicLink = async () => {
    const token = await ensureSaleToken()
    const url = `https://proispro.com/sale.html?token=${token}`
    await navigator.clipboard.writeText(url)
  }

  const publicSaleUrl = saleToken ? `https://proispro.com/sale.html?token=${saleToken}` : ''

  const getDiscForListing = (listing: ForSaleListing, allDiscs: ClientDisc[]): ClientDisc | null => {
    const live = allDiscs.find(d => d.id === listing.disc_id)
    if (live) return live
    return {
      id: listing.disc_id,
      name: listing.disc_name,
      manufacturer: listing.disc_manufacturer,
      type: listing.disc_type,
      plastic: listing.disc_plastic,
      weight: listing.disc_weight,
      color: listing.disc_color,
      condition: listing.disc_condition,
      speed: '',
      glide: '',
      turn: '',
      fade: '',
      notes: '',
      tags: [],
      photo_url: null,
      added: 0,
      quantity: 1,
    }
  }

  return {
    listings,
    saleToken,
    saleIsPublic,
    publicSaleUrl,
    loadListings,
    loadSaleToken,
    ensureSaleToken,
    addListing,
    deleteListing,
    updateStatus,
    togglePublic,
    copyPublicLink,
    getDiscForListing,
  }
}
