// Fork: types for @syncpoint/signs (MIT), which ships none. Only what My layers uses.
declare module '@syncpoint/signs' {
  export class Symbol {
    constructor(sidc: string, options?: { size?: number; [option: string]: unknown })
    asSVG(): string
    getSize(): { width: number; height: number }
    getAnchor(): { x: number; y: number }
  }
}
