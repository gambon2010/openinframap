// Fork: My layers' backend calls (api.ts): its types.
import { LayerAccess, UserFeature, UserLayer } from '../model/model.ts'

export interface LoadedLayer {
  id: string
  name: string
  style: UserLayer['style']
  access: LayerAccess
  owner: string | null
  version: number
  updated_by: string | null
  updated_at: string
  /** With their version, updated_by and updated_at too. */
  features: UserFeature[]
}

/** A named moment: the layers as they were after a saved change (userdata.situation). */
export interface Situation {
  id: number
  name: string
  change_id: number
  author: string | null
  created_at: string
  /** When that change was made. */
  at: string | null
}

/** Who a layer is shared with (its owner only). */
export interface LayerSharing {
  owner: string | null
  people: { id: number; name: string; level: 'view' | 'modify' | null }[]
}
