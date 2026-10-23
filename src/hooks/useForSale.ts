import { useState, useEffect, useCallback } from 'react'
import { createRow, deleteRows, ensureToken, listRows, saveToken, updateRow } from '../lib/data'
import { useAuth } from '../contexts/AuthContext'
import { ClientDisc } from '../utils/disc'

export interface ForSaleListing {
  id: string
  disc_id: string
  disc_name: string
  disc_manufacturer: string
  disc_type: string
  disc_plastic: string
  disc_color: string
  disc_weight: string
  disc_condition: string
  status: 'available' | 'sold'
  listed_at: string
}

export function useForSale() {
  const { user } = useAuth()
  const [listings, setListings] = useState<ForSaleListing[]>([])
  const [saleToken, setSaleToken] = useState<string>('')
  const [saleIsPublic, setSaleIsPublic] = useState<boolean>(false)
  const [tokenId, setTokenId] = useState('')

  const loadListings = useCallback(async () => {
    if (!user) return
    const data = await listRows<ForSaleListing>('forsale_listings')
    setListings(
      (data || []).map(l => ({
        id: l.id,
        disc_id: l.disc_id || '',
        disc_name: l.disc_name || '',
        disc_manufacturer: l.disc_manufacturer || '',
        disc_type: l.disc_type || '',
        disc_plastic: l.disc_plastic || '',
        disc_color: l.disc_color || '',
        disc_weight: l.disc_weight || '',
        disc_condition: l.disc_condition || 'good',
        status: l.status === 'sold' ? 'sold' : 'available',
        listed_at: l.listed_at,
      }))
    )
  }, [user])

  const loadSaleToken = useCallback(async () => {
    if (!user) return
    const [data] = await listRows<{ id: string; token: string; is_public: boolean }>('sale_tokens')
    if (data) {
      setSaleToken(data.token || '')
      setSaleIsPublic(data.is_public ?? false)
      setTokenId(data.id)
    }
  }, [user])

  useEffect(() => {
    void loadListings().catch(console.error)
    void loadSaleToken().catch(console.error)
  }, [loadListings, loadSaleToken])

  const ensureSaleToken = async (): Promise<string> => {
    if (!user) return ''
    if (saleToken) return saleToken
    const saved = await ensureToken()
    setSaleToken(saved.token)
    setTokenId(saved.id)
    return saved.token
  }

  const addListing = async (disc: ClientDisc) => {
    if (!user) return
    await createRow('forsale_listings', {
      disc_id: disc.id,
      disc_name: disc.name,
      disc_manufacturer: disc.manufacturer,
      disc_type: disc.type,
      disc_plastic: disc.plastic,
      disc_color: disc.color,
      disc_weight: disc.weight,
      disc_condition: disc.condition,
      status: 'available',
    })
    await loadListings()
  }

  const deleteListing = async (id: string) => {
    await deleteRows('forsale_listings', id)
    await loadListings()
  }

  const updateStatus = async (id: string, status: 'available' | 'sold') => {
    await updateRow('forsale_listings', id, { status })
    await loadListings()
  }

  const togglePublic = async () => {
    if (!user) return
    const saved = tokenId ? { id: tokenId, token: saleToken } : await ensureToken()
    setTokenId(saved.id)
    setSaleToken(saved.token)
    const newPublic = !saleIsPublic
    await saveToken(saved.id, newPublic)
    setSaleIsPublic(newPublic)
  }

  const copyPublicLink = async () => {
    const token = await ensureSaleToken()
    const url = `${window.location.origin}/sale.html?token=${token}`
    await navigator.clipboard.writeText(url)
  }

  const publicSaleUrl = saleToken ? `${window.location.origin}/sale.html?token=${saleToken}` : ''

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
