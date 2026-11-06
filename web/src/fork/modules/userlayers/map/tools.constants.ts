// Fork: drawing and editing on the map (tools.ts): its constants and tables.

// Its name while a drawing or placing tool has the map (ui/map-mode.ts).
export const MODE = 'userlayers-draw'

// How near (pixels) a click must be to an area's first point to close it there.
export const CLOSE_PX = 10

// A new point of an area: at least this far (pixels) from the others; closer than
// REPEAT_PX it's the second click of a double-click.
export const MIN_SEPARATION_PX = 12

export const REPEAT_PX = 4

// Scrolled this far (pixels) makes one 10 % step of size (a mouse wheel's notch is
// about 100; a touchpad sends many small steps).
export const WHEEL_NOTCH = 100

/** Each notch of Shift + scroll changes a size or width by 10 %. */
export const WHEEL_STEP_FACTOR = 1.1

/** How narrow or wide an arrow being drawn can be, against its automatic width. */
export const WIDTH_FACTOR_MIN = 0.2

export const WIDTH_FACTOR_MAX = 5

/** Pixels in a wheel "line" and a "page" (browsers report one of the three). */
export const WHEEL_LINE_PX = 40

export const WHEEL_PAGE_PX = 400
