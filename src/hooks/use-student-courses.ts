"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchStudentCourses,
  fetchStudentProfile,
  removeStudentCourse,
  updateStudentCourse,
  upsertStudentCourse,
  type StudentCourse,
  type StudentProfile,
  type UpdateStudentCourseInput,
  type UpsertStudentCourseInput,
} from "@/lib/student-courses";
import { createClient } from "@/lib/supabase/client";

export function useStudentCourses(semester?: string) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [courses, setCourses] = useState<StudentCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadForUser = useCallback(
    async (currentUser: User | null) => {
      if (!currentUser) {
        setProfile(null);
        setCourses([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const [loadedProfile, loadedCourses] = await Promise.all([
          fetchStudentProfile(supabase, currentUser.id),
          fetchStudentCourses(supabase, semester),
        ]);
        setProfile(loadedProfile);
        setCourses(loadedCourses);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load student courses.",
        );
      } finally {
        setLoading(false);
      }
    },
    [semester, supabase],
  );

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      const nextUser = data.user ?? null;
      setUser(nextUser);
      void loadForUser(nextUser);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      void loadForUser(nextUser);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadForUser, supabase]);

  const refresh = useCallback(async () => {
    await loadForUser(user);
  }, [loadForUser, user]);

  const addOrUpdateCourse = useCallback(
    async (input: UpsertStudentCourseInput) => {
      const saved = await upsertStudentCourse(supabase, input, user?.id);
      setCourses((prev) => {
        const idx = prev.findIndex((c) => c.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });
      return saved;
    },
    [supabase, user?.id],
  );

  const updateCourse = useCallback(
    async (id: string, updates: UpdateStudentCourseInput) => {
      const updated = await updateStudentCourse(supabase, id, updates);
      setCourses((prev) => prev.map((c) => (c.id === id ? updated : c)));
      return updated;
    },
    [supabase],
  );

  const removeCourse = useCallback(
    async (id: string) => {
      await removeStudentCourse(supabase, id);
      setCourses((prev) => prev.filter((c) => c.id !== id));
    },
    [supabase],
  );

  return {
    user,
    profile,
    courses,
    loading,
    error,
    refresh,
    addOrUpdateCourse,
    updateCourse,
    removeCourse,
  };
}
