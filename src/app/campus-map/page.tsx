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
          <div className="flex h-dvh w-full items-center justify-center bg-slate-100 text-sm font-semibold text-slate-600 dark:bg-zinc-950 dark:text-zinc-300">
            Loading campus map...
          </div>
        }
      >
        <CampusMapView />
      </Suspense>
    </>
  );
}
