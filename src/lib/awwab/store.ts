// Persistent local-storage abstraction. Raw user input only — never calculated values.
import { useSyncExternalStore } from "react";
import { isDomainId, latestVersion, systemHabits, type DomainId, type Frequency, type Habit, type HabitVersion, type InputType } from "./config";

export interface DailyEntry {
  date: string;
  activityId: string;
  value: number | null; // quantitative
  completed: boolean | null; // checklist: null = no data, false = explicitly not done
  createdAt: string;
  updatedAt: string;
}
export type Entries = Record<string, Record<string, DailyEntry>>; // date -> activityId -> entry

export type GoalStatus = "active" | "completed" | "archived";
export interface Goal {
  id: string;
  title: string;
  description: string;
  domainId: string | null;
  status: GoalStatus;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
}
export type ProjectStatus = "not_started" | "in_progress" | "completed" | "archived";
export interface Project {
  id: string;
  goalId: string;
  title: string;
  description: string;
  status: ProjectStatus;
  startDate: string | null;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description: string;
  dueDate: string | null;
  status: "pending" | "completed";
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Review {
  id: string;
  period: string; // YYYY-MM
  snapshot: {
    lifeScore: number | null;
    strongestDomain: string | null;
    needsAttention: string | null;
    biggestImprovement: string | null;
    biggestDecline: string | null;
    goalProgress: Record<string, number | null>;
  };
  wentWell: string;
  difficult: string;
  change: string;
  stop: string;
  continue: string;
  nextFocus: string;
  createdAt: string;
  updatedAt: string;
}

export type PlannerType = "EVENT" | "TASK" | "PLAN" | "NOTE";
export type PlannerCategory = "ACADEMIC" | "ORGANIZATION" | "CAREER" | "HEALTH" | "FINANCE" | "PERSONAL" | "SOCIAL" | "LIFE_MANAGEMENT";
export type PlannerStatus = "PLANNED" | "COMPLETED" | "CANCELLED";
/** Intention, never behavior: planner items are not scoring evidence. date = null → Inbox. */
export interface PlannerItem {
  id: string;
  title: string;
  description: string;
  type: PlannerType;
  category: PlannerCategory;
  date: string | null;
  startTime: string | null; // HH:MM
  endTime: string | null;
  status: PlannerStatus;
  goalId: string | null;
  projectId: string | null;
  milestoneId: string | null;
  activityId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AppState {
  version: 1;
  entries: Entries;
  goals: Goal[];
  projects: Project[];
  milestones: Milestone[];
  reviews: Review[];
  habits: Habit[];
  plannerItems: PlannerItem[];
}

const KEY = "awwab:v1";
const EMPTY: AppState = { version: 1, entries: {}, goals: [], projects: [], milestones: [], reviews: [], habits: systemHabits(), plannerItems: [] };

const arr = <X>(x: unknown): X[] => (Array.isArray(x) ? (x as X[]) : []);
const validHabit = (h: Habit) => !!h && typeof h.id === "string" && Array.isArray(h.versions) && h.versions.length > 0 && h.versions.every((v) => isDomainId(v.domain));

let state: AppState = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function parseState(p: any): AppState {
  const habits = arr<Habit>(p?.habits).filter(validHabit);
  return {
    version: 1,
    entries: p?.entries && typeof p.entries === "object" ? p.entries : {},
    goals: arr(p?.goals),
    projects: arr(p?.projects),
    milestones: arr(p?.milestones),
    reviews: arr(p?.reviews),
    habits: habits.length ? habits : systemHabits(),
    plannerItems: arr<PlannerItem>(p?.plannerItems).filter((x) => !!x && typeof x.id === "string" && typeof x.title === "string"),
  };
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) state = parseState(JSON.parse(raw) ?? {});
  } catch {
    state = EMPTY;
  }
}

/** True when the device holds any user-entered data. */
export const hasLocalData = (s: AppState) =>
  Object.keys(s.entries).length > 0 || s.goals.length > 0 || s.reviews.length > 0 || s.plannerItems.length > 0 || s.habits.some((h) => !h.isSystem || h.versions.length > 1);

/** Replace everything with a state loaded from the account (does not trigger a re-upload). */
export function replaceState(raw: unknown) {
  load();
  commit(parseState(raw), false);
}

const commitListeners = new Set<(s: AppState) => void>();
export const onCommit = (f: (s: AppState) => void) => { commitListeners.add(f); return () => { commitListeners.delete(f); }; };

function commit(next: AppState, notifySync = true) {
  state = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full / unavailable */
  }
  listeners.forEach((l) => l());
  if (notifySync) commitListeners.forEach((l) => l(state));
}

export function getState() {
  load();
  return state;
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState,
    () => EMPTY,
  );
}

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
const now = () => new Date().toISOString();

// ---------- Daily entries ----------
export function setEntry(date: string, activityId: string, patch: { value?: number | null; completed?: boolean | null }) {
  const s = getState();
  const day = { ...(s.entries[date] ?? {}) };
  const prev = day[activityId];
  const e: DailyEntry = {
    date,
    activityId,
    value: prev?.value ?? null,
    completed: prev?.completed ?? null,
    createdAt: prev?.createdAt ?? now(),
    updatedAt: now(),
    ...patch,
  };
  if (e.value === null && e.completed === null) delete day[activityId];
  else day[activityId] = e;
  commit({ ...s, entries: { ...s.entries, [date]: day } });
}

// ---------- Goals / projects / milestones ----------
export function saveGoal(g: Partial<Goal> & { title: string; id?: string | undefined }) {
  const s = getState();
  if (g.id && s.goals.some((x) => x.id === g.id)) {
    commit({ ...s, goals: s.goals.map((x) => (x.id === g.id ? { ...x, ...g, updatedAt: now() } : x)) });
    return g.id;
  }
  const goal: Goal = { id: uid(), description: "", domainId: null, status: "active", targetDate: null, createdAt: now(), updatedAt: now(), ...g };
  commit({ ...s, goals: [...s.goals, goal] });
  return goal.id;
}

export function saveProject(p: Partial<Project> & { title: string; goalId: string; id?: string | undefined }) {
  const s = getState();
  if (p.id && s.projects.some((x) => x.id === p.id)) {
    commit({ ...s, projects: s.projects.map((x) => (x.id === p.id ? { ...x, ...p, updatedAt: now() } : x)) });
    return p.id;
  }
  const proj: Project = { id: uid(), description: "", status: "not_started", startDate: null, targetDate: null, createdAt: now(), updatedAt: now(), ...p };
  commit({ ...s, projects: [...s.projects, proj] });
  return proj.id;
}

export function saveMilestone(m: Partial<Milestone> & { title: string; projectId: string }) {
  const s = getState();
  if (m.id && s.milestones.some((x) => x.id === m.id)) {
    commit({ ...s, milestones: s.milestones.map((x) => (x.id === m.id ? { ...x, ...m, updatedAt: now() } : x)) });
    return m.id;
  }
  const ms: Milestone = { id: uid(), description: "", dueDate: null, status: "pending", completedAt: null, createdAt: now(), updatedAt: now(), ...m };
  commit({ ...s, milestones: [...s.milestones, ms] });
  return ms.id;
}

export function toggleMilestone(id: string) {
  const s = getState();
  commit({
    ...s,
    milestones: s.milestones.map((m) =>
      m.id === id
        ? { ...m, status: m.status === "completed" ? "pending" : "completed", completedAt: m.status === "completed" ? null : now(), updatedAt: now() }
        : m,
    ),
  });
}

export function deleteMilestone(id: string) {
  const s = getState();
  commit({ ...s, milestones: s.milestones.filter((m) => m.id !== id) });
}

// ---------- Reviews ----------
export function saveReview(r: Omit<Review, "id" | "createdAt" | "updatedAt">) {
  const s = getState();
  const existing = s.reviews.find((x) => x.period === r.period);
  if (existing) {
    commit({ ...s, reviews: s.reviews.map((x) => (x.id === existing.id ? { ...x, ...r, updatedAt: now() } : x)) });
  } else {
    commit({ ...s, reviews: [...s.reviews, { ...r, id: uid(), createdAt: now(), updatedAt: now() }] });
  }
}

// ---------- Habits (versioned configuration) ----------
export interface HabitInput {
  name: string;
  domain: DomainId;
  inputType: InputType;
  target: number;
  unit: string;
  frequency: Frequency;
  weight: number;
}

/** Adds a new version effective `today`; replaces a version already created today. Never rewrites the past. */
function withVersion(h: Habit, today: string, patch: Partial<HabitVersion>): Habit {
  const last = latestVersion(h);
  const next: HabitVersion = { ...last, ...patch, effectiveFrom: today };
  const versions = last.effectiveFrom >= today ? [...h.versions.slice(0, -1), next] : [...h.versions, next];
  return { ...h, versions, updatedAt: now() };
}

const updateHabitState = (id: string, f: (h: Habit) => Habit) => {
  const s = getState();
  commit({ ...s, habits: s.habits.map((h) => (h.id === id ? f(h) : h)) });
};

export function createHabit(input: HabitInput, today: string) {
  const s = getState();
  const { name, ...v } = input;
  const h: Habit = {
    id: `h_${uid()}`,
    isSystem: false,
    customName: name.trim(),
    createdAt: now(),
    updatedAt: now(),
    archivedAt: null,
    versions: [{ ...v, target: v.inputType === "checklist" && v.frequency === "day" ? 1 : v.target, effectiveFrom: today, active: true }],
  };
  commit({ ...s, habits: [...s.habits, h] });
  return h.id;
}

/** `customName` null keeps the translated system name. */
export function updateHabit(id: string, customName: string | null, v: Omit<HabitInput, "name">, today: string) {
  updateHabitState(id, (h) => ({
    ...withVersion(h, today, { ...v, target: v.inputType === "checklist" && v.frequency === "day" ? 1 : v.target }),
    customName,
  }));
}

export function archiveHabit(id: string, today: string) {
  updateHabitState(id, (h) => ({ ...withVersion(h, today, { active: false }), archivedAt: now() }));
}

export function reactivateHabit(id: string, today: string) {
  updateHabitState(id, (h) => ({ ...withVersion(h, today, { active: true }), archivedAt: null }));
}

export const habitHasHistory = (s: AppState, id: string) => Object.values(s.entries).some((day) => !!day[id]);

/** Hard delete — only for habits without any recorded data. */
export function deleteHabit(id: string) {
  const s = getState();
  if (habitHasHistory(s, id)) return false;
  commit({ ...s, habits: s.habits.filter((h) => h.id !== id) });
  return true;
}

/** Explicit, user-triggered: scales active weights in a domain so they total 100. */
export function rebalanceDomain(domain: DomainId, today: string) {
  const s = getState();
  const act = s.habits.filter((h) => { const v = latestVersion(h); return v.active && v.domain === domain; });
  const total = act.reduce((x, h) => x + latestVersion(h).weight, 0);
  if (!act.length) return;
  const ids = new Set(act.map((h) => h.id));
  let assigned = 0;
  commit({
    ...s,
    habits: s.habits.map((h) => {
      if (!ids.has(h.id)) return h;
      const isLast = h.id === act[act.length - 1].id;
      const w = isLast ? Math.round((100 - assigned) * 10) / 10 : Math.round((total ? (latestVersion(h).weight / total) * 100 : 100 / act.length) * 10) / 10;
      assigned += w;
      return withVersion(h, today, { weight: w });
    }),
  });
}


// ---------- Planner (intention only — never touches entries, milestones or scores) ----------
export type PlannerInput = Partial<Omit<PlannerItem, "createdAt" | "updatedAt">> & { title: string };

export function savePlannerItem(input: PlannerInput) {
  const s = getState();
  const title = input.title.trim();
  if (!title) return null;
  if (input.id && s.plannerItems.some((x) => x.id === input.id)) {
    commit({ ...s, plannerItems: s.plannerItems.map((x) => (x.id === input.id ? { ...x, ...input, title, updatedAt: now() } : x)) });
    return input.id;
  }
  const item: PlannerItem = {
    description: "", type: "PLAN", category: "PERSONAL", date: null, startTime: null, endTime: null, status: "PLANNED",
    goalId: null, projectId: null, milestoneId: null, activityId: null, completedAt: null,
    ...input, id: uid(), title, createdAt: now(), updatedAt: now(),
  };
  commit({ ...s, plannerItems: [...s.plannerItems, item] });
  return item.id;
}

export function setPlannerStatus(id: string, status: PlannerStatus) {
  const s = getState();
  commit({
    ...s,
    plannerItems: s.plannerItems.map((x) => (x.id === id ? { ...x, status, completedAt: status === "COMPLETED" ? now() : null, updatedAt: now() } : x)),
  });
}

export function deletePlannerItem(id: string) {
  const s = getState();
  commit({ ...s, plannerItems: s.plannerItems.filter((x) => x.id !== id) });
}
