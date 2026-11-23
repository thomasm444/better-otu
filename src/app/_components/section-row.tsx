import type { Meeting, Section } from "@/lib/queries";

const DAYS = [
  ["monday", "Mon"],
  ["tuesday", "Tue"],
  ["wednesday", "Wed"],
  ["thursday", "Thu"],
  ["friday", "Fri"],
] as const;

export function SectionRow({ row }: { row: Section }) {
  const primary =
    row.course_faculty?.find((faculty) => faculty.primary_indicator) ??
    row.course_faculty?.[0];

  // A section can carry up to 12 meeting rows that render identically
  // (same time, same room, different category), so collapse duplicates.
  const meetings = [...new Set((row.course_meetings ?? []).map(describeMeeting))];

  return (
    <tr className="border-t border-black/[.06] align-top dark:border-white/[.10]">
      <td className="whitespace-nowrap px-4 py-3 font-code font-semibold">
        {row.subject} {row.course_number}
      </td>
      <td className="px-4 py-3">
        {row.course_title}
        <span className="ml-2 text-xs text-zinc-500">CRN {row.crn}</span>
      </td>
      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
        {primary?.display_name ?? "Unassigned"}
      </td>
      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
        {row.schedule_type_description ?? "—"}
      </td>
      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
        {meetings.length === 0 ? (
          "Not scheduled"
        ) : (
          <ul className="space-y-1">
            {meetings.map((description) => (
              <li key={description}>{description}</li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {row.seats_available ?? "—"}
        <span className="font-normal text-zinc-400 dark:text-zinc-500">
          /{row.maximum_enrollment ?? "—"}
        </span>
      </td>
    </tr>
  );
}

function describeMeeting(meeting: Meeting) {
  const days = DAYS.filter(([key]) => meeting[key]).map(([, label]) => label);

  const time = meeting.begin_time
    ? `${formatTime(meeting.begin_time)}–${formatTime(meeting.end_time)}`
    : "";

  const building = meeting.building ?? "";
  const room = meeting.room ?? "";
  // Banner often repeats the building prefix in the room, e.g. SCI + SCI1350.
  const location =
    building && room.startsWith(building)
      ? room
      : [building, room].filter(Boolean).join(" ");

  return [days.join("/") || "Async", time, location].filter(Boolean).join(" · ");
}

function formatTime(value: string | null) {
  if (!value) return "";
  const [hours, minutes] = value.split(":");
  const hour = Number(hours);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minutes} ${hour < 12 ? "am" : "pm"}`;
}
