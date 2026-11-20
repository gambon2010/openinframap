// Fork: the ground's height under the cursor (services/elevation.ts), asked once the
// cursor rests.
import { formatHeight, heightAt } from '../../services/elevation.ts'

/** How long the cursor rests before its height is asked (ms): not a request per pixel. */
export const REST_MS = 120

/** Calls `show` with the latest point's height once points stop coming for REST_MS;
 * an answer for a point since left behind is dropped. */
export function heightFollower(show: (text: string) => void): (lng: number, lat: number) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let asked = 0
  return (lng, lat) => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const ask = ++asked
      const metres = await heightAt(lng, lat)
      if (ask === asked) show(formatHeight(metres))
    }, REST_MS)
  }
}
