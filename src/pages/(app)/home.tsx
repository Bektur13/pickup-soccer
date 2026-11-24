/**
 * Home — a full-screen map of Bellevue, WA, filling everything below the
 * top bar. Lives under (app)/ so it can use DeepSpace data hooks later
 * (e.g. pickup games as map markers).
 */

import { PickupMap } from '../../components/map/PickupMap'

export default function HomePage() {
  return (
    <div data-testid="home-map" className="h-full w-full">
      <PickupMap />
    </div>
  )
}
