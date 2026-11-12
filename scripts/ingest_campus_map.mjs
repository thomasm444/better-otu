import fs from "fs";
import path from "path";
import pg from "pg";

const { Client } = pg;

const REPO_ROOT = process.cwd();
const MAP_DIR = path.join(REPO_ROOT, "python_scripts/map");
const JSONS_DIR = path.join(MAP_DIR, "jsons");

async function ingest() {
  console.log("Reading map JSON files...");

  // 1. Room Booking Details
  const bdetailsPath = path.join(JSONS_DIR, "room_booking_details.json");
  const bdetails = JSON.parse(fs.readFileSync(bdetailsPath, "utf-8"));
  const bookingRows = [];
  const ccRemap = {
    CC2127: "CCB2127",
    CC2322: "CCB2322",
    CC2323: "CCB2323",
    CC2324: "CCB2324",
    CC2402: "CCB2402WS",
    CC3305: "CCB3305",
    CC3320: "CCB3320",
    CC3322A: "CCB3322A",
    "1303": "SIR1303",
  };

  for (const row of bdetails.response?.data || []) {
    const ld = row.listData || [];
    if (ld.length >= 8) {
      const rawName = String(ld[2] || "").trim();
      const room = ccRemap[rawName] || rawName;
      const capInt = parseInt(ld[4], 10);
      bookingRows.push({
        room,
        campus: ld[0] || null,
        building: ld[1] || null,
        room_type: ld[3] || null,
        capacity: Number.isFinite(capInt) ? capInt : null,
        config_type: ld[6] || null,
        description: ld[7] || null,
        raw_data: row,
      });
    }
  }
  console.log(`Loaded ${bookingRows.length} room_booking_details rows.`);

  // 2. Library Study Rooms
  const libPath = path.join(JSONS_DIR, "library_study_rooms.json");
  const libData = JSON.parse(fs.readFileSync(libPath, "utf-8"));
  const libRows = [];
  for (const [rid, rInfo] of Object.entries(libData.byRoom || {})) {
    libRows.push({
      room_id: rid,
      min_capacity: rInfo.minCapacity ?? null,
      max_capacity: rInfo.maxCapacity ?? null,
      bookings: rInfo.bookings || [],
    });
  }
  console.log(`Loaded ${libRows.length} library_study_rooms rows.`);

  // 3. Room Detailed Reservations
  const resPath = path.join(JSONS_DIR, "room_detailed_reservations.json");
  const resData = JSON.parse(fs.readFileSync(resPath, "utf-8"));
  const resRows = [];
  for (const item of resData) {
    const rawR = (item.roomId || "").trim();
    if (!rawR) continue;
    const r = ccRemap[rawR] || rawR;
    for (const res of item.detailedReservations || []) {
      const title = res.content?.popupContent || "Room Reservation";
      for (const occ of res.occurrences || []) {
        const d = occ.day;
        const st = occ.startTime;
        const dur = occ.duration;
        if (d >= 1 && d <= 7 && st != null && dur > 0) {
          resRows.push({
            room_id: r,
            day: d,
            start_time: st,
            duration: dur,
            end_time: st + dur,
            title,
            type: "reservation",
          });
        }
      }
    }
  }
  console.log(`Loaded ${resRows.length} room_detailed_reservations occurrences.`);

  // 4. Compiled Map Features & Unmapped Rooms from rooms_data.js
  const roomsDataJs = fs.readFileSync(path.join(MAP_DIR, "rooms_data.js"), "utf-8");
  const jsonStr = roomsDataJs.replace(/^\s*window\.ROOMS_DATA\s*=\s*/, "").replace(/;\s*$/, "");
  const compiledData = JSON.parse(jsonStr);

  const features = compiledData.features || [];
  const unmapped = compiledData.unmappedDetailedRes || [];
  console.log(`Loaded ${features.length} map features and ${unmapped.length} unmapped rooms.`);

  // Connect to Supabase Postgres
  const client = new Client({
    host: "aws-0-us-east-1.pooler.supabase.com",
    port: 6543,
    user: "postgres.ayxxunfcieoujoolqdbl",
    password: process.env.SUPABASE_DATABASE_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });

  console.log("Connecting to Supabase Postgres database...");
  await client.connect();

  console.log("Beginning ingestion transaction...");
  await client.query("BEGIN;");

  try {
    // A. Ingest room_booking_details
    console.log("Ingesting room_booking_details...");
    for (const r of bookingRows) {
      await client.query(
        `INSERT INTO public.room_booking_details (room, campus, building, room_type, capacity, config_type, description, raw_data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (room) DO UPDATE SET
           campus = EXCLUDED.campus,
           building = EXCLUDED.building,
           room_type = EXCLUDED.room_type,
           capacity = EXCLUDED.capacity,
           config_type = EXCLUDED.config_type,
           description = EXCLUDED.description,
           raw_data = EXCLUDED.raw_data,
           updated_at = now();`,
        [
          r.room,
          r.campus,
          r.building,
          r.room_type,
          r.capacity,
          r.config_type,
          r.description,
          JSON.stringify(r.raw_data),
        ]
      );
    }

    // B. Ingest library_study_rooms
    console.log("Ingesting library_study_rooms...");
    for (const r of libRows) {
      await client.query(
        `INSERT INTO public.library_study_rooms (room_id, min_capacity, max_capacity, bookings, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (room_id) DO UPDATE SET
           min_capacity = EXCLUDED.min_capacity,
           max_capacity = EXCLUDED.max_capacity,
           bookings = EXCLUDED.bookings,
           updated_at = now();`,
        [r.room_id, r.min_capacity, r.max_capacity, JSON.stringify(r.bookings)]
      );
    }

    // C. Ingest room_detailed_reservations
    console.log("Ingesting room_detailed_reservations...");
    await client.query("TRUNCATE TABLE public.room_detailed_reservations RESTART IDENTITY;");
    const resBatchSize = 1000;
    for (let i = 0; i < resRows.length; i += resBatchSize) {
      const batch = resRows.slice(i, i + resBatchSize);
      const values = [];
      const params = [];
      let idx = 1;
      for (const row of batch) {
        values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, now())`);
        params.push(row.room_id, row.day, row.start_time, row.duration, row.end_time, row.title, row.type);
        idx += 7;
      }
      await client.query(
        `INSERT INTO public.room_detailed_reservations (room_id, day, start_time, duration, end_time, title, type, updated_at)
         VALUES ${values.join(", ")};`,
        params
      );
    }

    // D. Ingest campus_unmapped_spaces
    console.log("Ingesting campus_unmapped_spaces...");
    for (const u of unmapped) {
      await client.query(
        `INSERT INTO public.campus_unmapped_spaces (room_id, building, room_type, capacity, description, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (room_id) DO UPDATE SET
           building = EXCLUDED.building,
           room_type = EXCLUDED.room_type,
           capacity = EXCLUDED.capacity,
           description = EXCLUDED.description,
           updated_at = now();`,
        [u.roomId, u.building, u.roomType, String(u.capacity || ""), u.description]
      );
    }

    // E. Ingest campus_spaces (7,508 features in batches of 400)
    console.log(`Ingesting ${features.length} campus_spaces features...`);
    const featureBatchSize = 400;
    for (let i = 0; i < features.length; i += featureBatchSize) {
      const batch = features.slice(i, i + featureBatchSize);
      const values = [];
      const params = [];
      let idx = 1;

      for (const f of batch) {
        const p = f.properties || {};
        values.push(
          `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10}, $${idx + 11}, $${idx + 12}, $${idx + 13}, $${idx + 14}, $${idx + 15}, $${idx + 16}, $${idx + 17}, $${idx + 18}, $${idx + 19}, $${idx + 20}, now())`
        );
        params.push(
          f.id,
          p.name || null,
          p.externalId || null,
          p.building || null,
          p.floor != null ? String(p.floor) : null,
          p.floorName || null,
          p.venue || null,
          p.type || null,
          Number.isFinite(p.capacity) ? p.capacity : null,
          Number.isFinite(p.minCapacity) ? p.minCapacity : null,
          p.capacitySource || null,
          p.configType || null,
          Boolean(p.isBuildingContainer),
          Boolean(p.hasSchedule),
          Boolean(p.isLibraryRoom),
          JSON.stringify(f.geometry),
          p.rooms ? JSON.stringify(p.rooms) : null,
          p.roomsData ? JSON.stringify(p.roomsData) : null,
          p.schedules ? JSON.stringify(p.schedules) : null,
          p.courses ? JSON.stringify(p.courses) : null,
          p.allCourses ? JSON.stringify(p.allCourses) : null
        );
        idx += 21;
      }

      await client.query(
        `INSERT INTO public.campus_spaces (
           id, name, external_id, building, floor, floor_name, venue, room_type,
           capacity, min_capacity, capacity_source, config_type,
           is_building_container, has_schedule, is_library_room,
           geometry, sub_rooms, rooms_data, schedules, courses, all_courses, updated_at
         )
         VALUES ${values.join(", ")}
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           external_id = EXCLUDED.external_id,
           building = EXCLUDED.building,
           floor = EXCLUDED.floor,
           floor_name = EXCLUDED.floor_name,
           venue = EXCLUDED.venue,
           room_type = EXCLUDED.room_type,
           capacity = EXCLUDED.capacity,
           min_capacity = EXCLUDED.min_capacity,
           capacity_source = EXCLUDED.capacity_source,
           config_type = EXCLUDED.config_type,
           is_building_container = EXCLUDED.is_building_container,
           has_schedule = EXCLUDED.has_schedule,
           is_library_room = EXCLUDED.is_library_room,
           geometry = EXCLUDED.geometry,
           sub_rooms = EXCLUDED.sub_rooms,
           rooms_data = EXCLUDED.rooms_data,
           schedules = EXCLUDED.schedules,
           courses = EXCLUDED.courses,
           all_courses = EXCLUDED.all_courses,
           updated_at = now();`,
        params
      );
      process.stdout.write(`  Inserted ${Math.min(i + featureBatchSize, features.length)} / ${features.length} spaces...\r`);
    }
    console.log("\nFinished ingesting campus_spaces!");

    console.log("Refreshing campus_map_cache...");
    await client.query(`
      INSERT INTO public.campus_map_cache (id, data, updated_at)
      VALUES (
        'default',
        (
          SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', coalesce(
              (
                SELECT json_agg(
                  json_build_object(
                    'type', 'Feature',
                    'id', id,
                    'geometry', geometry,
                    'properties', json_build_object(
                      'name', name,
                      'externalId', external_id,
                      'floor', floor,
                      'floorName', floor_name,
                      'building', building,
                      'venue', venue,
                      'type', room_type,
                      'capacity', capacity,
                      'minCapacity', min_capacity,
                      'capacitySource', capacity_source,
                      'configType', config_type,
                      'isBuildingContainer', is_building_container,
                      'hasSchedule', has_schedule,
                      'isLibraryRoom', is_library_room,
                      'rooms', sub_rooms,
                      'roomsData', rooms_data,
                      'schedules', schedules,
                      'courses', courses,
                      'allCourses', all_courses
                    )
                  )
                )
                FROM public.campus_spaces
              ),
              '[]'::json
            ),
            'unmappedDetailedRes', coalesce(
              (
                SELECT json_agg(
                  json_build_object(
                    'roomId', room_id,
                    'building', building,
                    'roomType', room_type,
                    'capacity', capacity,
                    'description', description
                  )
                )
                FROM public.campus_unmapped_spaces
              ),
              '[]'::json
            )
          )
        ),
        now()
      )
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now();
    `);

    await client.query("NOTIFY pgrst, 'reload schema';");
    await client.query("COMMIT;");
    console.log("Ingestion successfully committed to Supabase!");
  } catch (err) {
    await client.query("ROLLBACK;");
    throw err;
  } finally {
    await client.end();
  }
}

ingest().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
