// Fork: the ground under the cursor, its height and slope (services/elevation.ts),
// asked once the cursor rests.
import { groundAt, type Ground } from '../../services/elevation.ts'

/** How long the cursor rests before the ground is asked (ms): not a request per pixel. */
export const REST_MS = 120

/** Calls `show` with the latest point's ground once points stop coming for REST_MS;
 * an answer for a point since left behind is dropped. */
export function groundFollower(show: (ground: Ground) => void): (lng: number, lat: number) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let asked = 0
  return (lng, lat) => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const ask = ++asked
      const ground = await groundAt(lng, lat)
      if (ask === asked) show(ground)
    }, REST_MS)
  }
}
