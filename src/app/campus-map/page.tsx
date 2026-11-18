import { CampusMapView } from "./campus-map-view";

export const metadata = {
  title: "Campus Maap & Room Availability | Better OTU",
  description:
    "Interactive campus map and live room vacancy finder for Ontario Tech University.",
};

export default function CampusMapPage() {
  return (
    <>
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />
      <CampusMapView />
    </>
  );
}
