import { Suspense } from "react";
import { CampusMapView } from "./campus-map-view";

export const metadata = {
  title: "Campus Map & Room Availability | Better OTU",
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
      <Suspense
        fallback={
          <div className="flex h-[calc(100dvh-var(--site-nav-height,2.75rem)-var(--site-footer-height,2rem))] w-full items-center justify-center bg-canvas text-sm font-medium text-ink-secondary">
            Loading campus map...
          </div>
        }
      >
        <CampusMapView />
      </Suspense>
    </>
  );
}
