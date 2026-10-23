import { useEffect, useState } from 'react'
import { loadDiscPhoto } from '../lib/data'

export function DiscPhoto({ src, name }: { src: string; name: string }) {
  const [image, setImage] = useState<{ src: string; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const privatePhoto = src.startsWith('/api/v1/discs/')
  useEffect(() => {
    setError(null)
    if (!privatePhoto) return
    const controller = new AbortController()
    let objectUrl: string | undefined
    void loadDiscPhoto(src, controller.signal).then(blob => {
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setImage({ src, url: objectUrl })
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Photo could not be loaded.')
    })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [src, privatePhoto, retry])
  if (error) return <button type="button" className="disc-photo-error" title={error}
    onClick={() => { setError(null); setRetry(value => value + 1) }}>
    Photo unavailable. Retry
  </button>
  const url = privatePhoto ? image?.src === src ? image.url : null : src
  return url ? <img className="disc-photo" src={url} alt={`${name} personal photo`}
    onError={() => setError('Photo could not be displayed.')} /> : <span role="status" className="disc-photo-loading">Loading photo...</span>
}
