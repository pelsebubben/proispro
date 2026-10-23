import { ArtDisc, DiscArt } from './DiscArt'
import { DiscPhoto } from './DiscPhoto'

// The user's own photo when there is one, otherwise the generated stock illustration.
// `photo` is a private photo path or, while editing, a local data URL.
export function DiscImage({ disc, photo, stamp }: { disc: ArtDisc; photo?: string | null; stamp?: boolean }) {
  return photo ? <DiscPhoto src={photo} name={disc.name || 'Disc'} /> : <DiscArt disc={disc} stamp={stamp} />
}
