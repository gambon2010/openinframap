/** A building's number ("STR-NEU-12") and the name OpenStreetMap gives it, each null
 * when it has none (web-backend /background/building-names). */
export interface BuildingNames {
  number: string | null
  name: string | null
}
