// Fork: My layers' map drawing (render.ts): the shapes it's given.

/** A graphic being drawn (Renderer.graphicDraft). */
export interface GraphicDraft {
  sidc: string
  points: [number, number][]
  /** An arrow: the points are its path (its width follows from them). */
  axis?: boolean
  /** An arrow: its width against the automatic one. */
  widthFactor?: number
  colour: string
}

/** A box around an image's drawn part: px from its centre (left and top negative). */
export interface IconBox {
  left: number
  top: number
  right: number
  bottom: number
}
