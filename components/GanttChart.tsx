"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Shape = "rect" | "pill" | "diamond";

interface SubTask {
  id: number;
  name: string;
  start: string;
  end: string;
  colorIdx: number;
  shape: Shape;
  memo: string;
  memoOpen: boolean;
  comment: string;
  commentOpen: boolean;
}

interface Task extends SubTask {
  assignee: string;
  expanded: boolean;
  subtasks: SubTask[];
  dependsOn: number[];
}

const RAINBOW: { bg: string; text: string }[] = [
  { bg: "#E53935", text: "#FFFFFF" },
  { bg: "#FB8C00", text: "#FFFFFF" },
  { bg: "#FDD835", text: "#5C4400" },
  { bg: "#43A047", text: "#FFFFFF" },
  { bg: "#1E88E5", text: "#FFFFFF" },
  { bg: "#3949AB", text: "#FFFFFF" },
  { bg: "#8E24AA", text: "#FFFFFF" },
];

const LEGEND_LABELS = ["긴급/지연", "진행중", "검토중", "완료", "예정", "보류", "취소"];

const SHAPES: Shape[] = ["rect", "pill", "diamond"];

const ROW_HEIGHT = 40;
const MEMO_HEIGHT = 64;
const ASSIGNEE_WIDTH = 90;
const DEFAULT_LABEL_WIDTH = 240;
const MIN_LABEL_WIDTH = 140;
const MAX_LABEL_WIDTH = 600;
const DATE_COL_WIDTH = 120;
const MONTH_ROW_HEIGHT = 20;
const DAY_ROW_HEIGHT = 36;
const TOTAL_HEADER_HEIGHT = MONTH_ROW_HEIGHT + DAY_ROW_HEIGHT;
const CONTENT_OFFSET = 18; // padding above rows

const STORAGE_KEY = "gantt-v2";

// ---- Helpers ----
function fmt(d: Date): string {
  // toISOString() converts to UTC, which shifts the date back a day in
  // timezones ahead of UTC (e.g. KST). Format from local fields instead.
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function fmtShort(s: string): string {
  return s.slice(5);
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function parseDate(s: string): Date {
  const p = s.split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// ---- localStorage ----
interface StoredData {
  tasks: Task[];
  dayWidth: number;
  totalDays: number;
  rangeOffset: number;
  labelWidth?: number;
}

function loadFromStorage(): StoredData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as StoredData;
    // Migrate: ensure dependsOn and comment fields exist
    data.tasks = data.tasks.map((t) => ({
      ...t,
      dependsOn: t.dependsOn ?? [],
      subtasks: t.subtasks.map((s) => ({
        ...s,
        comment: s.comment ?? "",
        commentOpen: s.commentOpen ?? false,
      })),
    }));
    return data;
  } catch {
    return null;
  }
}

// ---- Initial data ----
function makeInitialTasks(): Task[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return [
    {
      id: 1,
      name: "요구사항 정리",
      assignee: "김민준",
      start: fmt(addDays(today, -2)),
      end: fmt(addDays(today, 1)),
      colorIdx: 4,
      shape: "rect",
      expanded: true,
      memo: "",
      memoOpen: false,
      comment: "",
      commentOpen: false,
      dependsOn: [],
      subtasks: [
        { id: 101, name: "설문 조사", start: fmt(addDays(today, -2)), end: fmt(addDays(today, -1)), colorIdx: 4, shape: "rect", memo: "", memoOpen: false, comment: "", commentOpen: false },
        { id: 102, name: "요구사항 문서화", start: fmt(today), end: fmt(addDays(today, 1)), colorIdx: 4, shape: "rect", memo: "", memoOpen: false, comment: "", commentOpen: false },
      ],
    },
    {
      id: 2,
      name: "디자인 시안",
      assignee: "이서연",
      start: fmt(addDays(today, 2)),
      end: fmt(addDays(today, 6)),
      colorIdx: 0,
      shape: "rect",
      expanded: false,
      memo: "",
      memoOpen: false,
      comment: "",
      commentOpen: false,
      dependsOn: [1],
      subtasks: [
        { id: 201, name: "와이어프레임", start: fmt(addDays(today, 2)), end: fmt(addDays(today, 3)), colorIdx: 0, shape: "rect", memo: "", memoOpen: false, comment: "", commentOpen: false },
        { id: 202, name: "시각 디자인", start: fmt(addDays(today, 4)), end: fmt(addDays(today, 6)), colorIdx: 0, shape: "rect", memo: "", memoOpen: false, comment: "", commentOpen: false },
      ],
    },
    {
      id: 3,
      name: "개발",
      assignee: "박지훈",
      start: fmt(addDays(today, 5)),
      end: fmt(addDays(today, 14)),
      colorIdx: 5,
      shape: "rect",
      expanded: false,
      memo: "",
      memoOpen: false,
      comment: "",
      commentOpen: false,
      dependsOn: [2],
      subtasks: [],
    },
    {
      id: 4,
      name: "테스트",
      assignee: "정유나",
      start: fmt(addDays(today, 12)),
      end: fmt(addDays(today, 16)),
      colorIdx: 3,
      shape: "rect",
      expanded: false,
      memo: "",
      memoOpen: false,
      comment: "",
      commentOpen: false,
      dependsOn: [3],
      subtasks: [],
    },
  ];
}

type Row =
  | { type: "task"; task: Task; num: number; top: number; h: number }
  | { type: "subtask"; task: Task; sub: SubTask; top: number; h: number }
  | { type: "memo"; task: Task; sub: SubTask | null; top: number; h: number }
  | { type: "comment"; task: Task; sub: SubTask; top: number; h: number }
  | { type: "addsub"; task: Task; top: number; h: number };

// Shows a compact MM-DD label but keeps a full native date input on top (invisible)
// so clicking still opens the browser's date picker with the year intact.
function DateField({
  value, onChange, min, max,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <div style={{ position: "relative", flex: "0 0 44px", width: 44, height: 25 }}>
      <span
        style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", padding: "0 3px",
          fontSize: 11, border: "0.5px solid #d8d5cc", borderRadius: 6, background: "#fff", color: "#1a1a18",
          fontVariantNumeric: "tabular-nums", boxSizing: "border-box", whiteSpace: "nowrap", overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        {fmtShort(value)}
      </span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer",
          border: "none", padding: 0, margin: 0,
        }}
      />
    </div>
  );
}

export default function GanttChart() {
  // Always start from hardcoded defaults so the very first client render matches
  // the server-rendered HTML exactly. Reading localStorage during the initial
  // render causes a hydration mismatch on this static page, and — unlike a normal
  // mismatch that self-corrects — the mismatched DOM attributes never got patched
  // on subsequent renders, silently freezing the UI at the default sizes forever
  // even though the actual React state was correct. Persisted values are applied
  // in an effect below, after mount, which is a real (non-hydration) render pass.
  const [tasks, setTasks] = useState<Task[]>(() => makeInitialTasks());
  const [dayWidth, setDayWidth] = useState(32);
  const [totalDays, setTotalDays] = useState(90);
  const [rangeOffset, setRangeOffset] = useState(-7);
  const [labelWidth, setLabelWidth] = useState(DEFAULT_LABEL_WIDTH);
  const [hydrated, setHydrated] = useState(false);
  const [isResizingLabel, setIsResizingLabel] = useState(false);
  const [linkSource, setLinkSource] = useState<number | null>(null);
  const [newTaskName, setNewTaskName] = useState("");

  const nextIdRef = useRef(5);
  const nextSubIdRef = useRef(1000);
  const undoStack = useRef<Task[][]>([]);

  useEffect(() => {
    const saved = loadFromStorage();
    if (saved) {
      setTasks(saved.tasks);
      setDayWidth(saved.dayWidth);
      setTotalDays(saved.totalDays);
      setRangeOffset(saved.rangeOffset);
      setLabelWidth(saved.labelWidth ?? DEFAULT_LABEL_WIDTH);
      nextIdRef.current = Math.max(4, ...saved.tasks.map((t) => t.id)) + 1;
      nextSubIdRef.current = Math.max(999, ...saved.tasks.flatMap((t) => t.subtasks.map((s) => s.id))) + 1;
    }
    setHydrated(true);
  }, []);

  // ---- Row reorder drag ----
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const rowDragRef = useRef<{ type: "task" | "subtask"; taskId: number; subId?: number } | null>(null);
  const dropInsertRef = useRef<{ type: "task" | "subtask"; parentTaskId?: number; idx: number } | null>(null);
  const [dropLine, setDropLine] = useState<number | null>(null); // lineY in row coords
  const rowsRef = useRef<Row[]>([]);
  const tasksRef = useRef<Task[]>([]);

  function pushUndo(current: Task[]) {
    undoStack.current = [...undoStack.current.slice(-49), JSON.parse(JSON.stringify(current))];
  }

  function undo() {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    setTasks(prev);
  }

  // ---- Persist to localStorage ----
  // Skip writes until the load effect above has run — otherwise this fires on
  // the very first commit (still holding hardcoded defaults) and overwrites a
  // returning user's saved settings before they ever get applied.
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, dayWidth, totalDays, rangeOffset, labelWidth }));
  }, [hydrated, tasks, dayWidth, totalDays, rangeOffset, labelWidth]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const rangeStart = useMemo(() => addDays(today, rangeOffset), [today, rangeOffset]);

  const rows: Row[] = useMemo(() => {
    const list: Row[] = [];
    tasks.forEach((t, i) => {
      // Rows with dependency tags get extra height so the tags can wrap onto
      // their own line below the (now narrower) date fields instead of clipping them.
      list.push({ type: "task", task: t, num: i + 1, top: 0, h: ROW_HEIGHT + (t.dependsOn.length > 0 ? 16 : 0) });
      if (t.expanded) {
        if (t.memoOpen) list.push({ type: "memo", task: t, sub: null, top: 0, h: MEMO_HEIGHT });
        t.subtasks.forEach((sub) => {
          list.push({ type: "subtask", task: t, sub, top: 0, h: ROW_HEIGHT });
          if (sub.memoOpen) list.push({ type: "memo", task: t, sub, top: 0, h: MEMO_HEIGHT });
          if (sub.commentOpen) list.push({ type: "comment", task: t, sub, top: 0, h: MEMO_HEIGHT });
        });
        list.push({ type: "addsub", task: t, top: 0, h: ROW_HEIGHT });
      }
    });
    let top = 0;
    for (const row of list) {
      row.top = top;
      top += row.h;
    }
    return list;
  }, [tasks]);

  // Keep refs in sync (must be after rows/tasks declarations)
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const leftWidth = ASSIGNEE_WIDTH + labelWidth + DATE_COL_WIDTH;
  const totalHeight = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].h : 0;
  const fullWidth = leftWidth + totalDays * dayWidth;

  // ---- Task map for dependency arrows ----
  const taskRowMap = useMemo(() => {
    const m = new Map<number, Row & { type: "task" }>();
    rows.forEach((r) => {
      if (r.type === "task") m.set(r.task.id, r as Row & { type: "task" });
    });
    return m;
  }, [rows]);

  // ---- Updaters ----
  function updateTask(taskId: number, updater: (t: Task) => Task) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updater(t) : t)));
  }
  function updateSub(taskId: number, subId: number, updater: (s: SubTask) => SubTask) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, subtasks: t.subtasks.map((s) => (s.id === subId ? updater(s) : s)) }
          : t
      )
    );
  }

  function toggleExpanded(taskId: number) {
    updateTask(taskId, (t) => ({
      ...t,
      expanded: !t.expanded,
      memoOpen: t.expanded ? false : t.memoOpen,
      subtasks: t.expanded ? t.subtasks.map((s) => ({ ...s, memoOpen: false })) : t.subtasks,
    }));
  }
  function toggleTaskMemo(taskId: number) {
    updateTask(taskId, (t) => ({ ...t, memoOpen: !t.memoOpen }));
  }
  function toggleSubMemo(taskId: number, subId: number) {
    updateSub(taskId, subId, (s) => ({ ...s, memoOpen: !s.memoOpen }));
  }
  function toggleSubComment(taskId: number, subId: number) {
    updateSub(taskId, subId, (s) => ({ ...s, commentOpen: !s.commentOpen }));
  }
  function deleteTask(taskId: number) {
    setTasks((prev) => {
      pushUndo(prev);
      return prev
        .filter((t) => t.id !== taskId)
        .map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => d !== taskId) }));
    });
  }
  function deleteSub(taskId: number, subId: number) {
    setTasks((prev) => {
      pushUndo(prev);
      return prev.map((t) =>
        t.id === taskId ? { ...t, subtasks: t.subtasks.filter((s) => s.id !== subId) } : t
      );
    });
  }
  function addSub(taskId: number) {
    const id = nextSubIdRef.current++;
    setTasks((prev) => { pushUndo(prev); return prev; });
    updateTask(taskId, (t) => ({
      ...t,
      expanded: true,
      subtasks: [
        ...t.subtasks,
        { id, name: "새 세부 일정", start: fmt(today), end: fmt(addDays(today, 2)), colorIdx: 0, shape: "rect", memo: "", memoOpen: false, comment: "", commentOpen: false },
      ],
    }));
  }
  function addTask() {
    const name = newTaskName.trim();
    if (!name) return;
    const id = nextIdRef.current++;
    setTasks((prev) => { pushUndo(prev); return prev; });
    setTasks((prev) => [
      ...prev,
      {
        id,
        name,
        assignee: "",
        start: fmt(today),
        end: fmt(addDays(today, 3)),
        colorIdx: prev.length % RAINBOW.length,
        shape: "rect",
        expanded: false,
        memo: "",
        memoOpen: false,
        comment: "",
        commentOpen: false,
        dependsOn: [],
        subtasks: [],
      },
    ]);
    setNewTaskName("");
  }
  function cycleShape(taskId: number, subId: number | null) {
    setTasks((prev) => { pushUndo(prev); return prev; });
    if (subId === null) {
      updateTask(taskId, (t) => ({ ...t, shape: SHAPES[(SHAPES.indexOf(t.shape) + 1) % SHAPES.length] }));
    } else {
      updateSub(taskId, subId, (s) => ({ ...s, shape: SHAPES[(SHAPES.indexOf(s.shape) + 1) % SHAPES.length] }));
    }
  }
  function cycleColor(taskId: number, subId: number | null) {
    setTasks((prev) => { pushUndo(prev); return prev; });
    if (subId === null) {
      updateTask(taskId, (t) => ({ ...t, colorIdx: (t.colorIdx + 1) % RAINBOW.length }));
    } else {
      updateSub(taskId, subId, (s) => ({ ...s, colorIdx: (s.colorIdx + 1) % RAINBOW.length }));
    }
  }

  // ---- Dependency link mode ----
  function handleLinkClick(taskId: number) {
    if (linkSource === null) {
      setLinkSource(taskId);
    } else if (linkSource === taskId) {
      setLinkSource(null);
    } else {
      setTasks((prev) => { pushUndo(prev); return prev; });
      updateTask(taskId, (t) => ({
        ...t,
        dependsOn: t.dependsOn.includes(linkSource) ? t.dependsOn : [...t.dependsOn, linkSource],
      }));
      setLinkSource(null);
    }
  }
  function removeDep(taskId: number, depId: number) {
    updateTask(taskId, (t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => d !== depId) }));
  }

  // ---- CSV Export ----
  function exportCSV() {
    const rows2: string[] = ["이름,담당자,시작일,종료일,메모"];
    for (const t of tasks) {
      rows2.push([t.name, t.assignee, t.start, t.end, `"${t.memo.replace(/"/g, '""')}"`].join(","));
      for (const s of t.subtasks) {
        rows2.push([`  ${s.name}`, "", s.start, s.end, `"${s.memo.replace(/"/g, '""')}"`].join(","));
      }
    }
    const blob = new Blob(["﻿" + rows2.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gantt.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- PNG Export ----
  const chartRef = useRef<HTMLDivElement | null>(null);
  async function exportPNG() {
    if (!chartRef.current) return;
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(chartRef.current, { scale: 2, useCORS: true });
      const a = document.createElement("a");
      a.download = "gantt.png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch {
      alert("이미지 저장에 실패했습니다.");
    }
  }

  // ---- Drag ----
  const dragRef = useRef<{
    taskId: number;
    subId: number | null;
    mode: "move" | "left" | "right";
    startX: number;
    origStart: Date;
    origEnd: Date;
  } | null>(null);

  // Ctrl+Z undo
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dayDelta = Math.round(dx / dayWidth);
      // Bars can't move earlier than the calendar's leftmost visible date —
      // otherwise they'd slide behind the frozen assignee/label/date panel and become unreachable.
      function apply(start: string, end: string): { start: string; end: string } {
        if (d!.mode === "move") {
          const minDelta = diffDays(d!.origStart, rangeStart);
          const delta = Math.max(dayDelta, minDelta);
          return { start: fmt(addDays(d!.origStart, delta)), end: fmt(addDays(d!.origEnd, delta)) };
        }
        if (d!.mode === "left") {
          let ns = addDays(d!.origStart, dayDelta);
          if (diffDays(rangeStart, ns) < 0) ns = rangeStart;
          if (diffDays(ns, d!.origEnd) >= 0) return { start: fmt(ns), end };
          return { start, end };
        }
        const ne = addDays(d!.origEnd, dayDelta);
        if (diffDays(d!.origStart, ne) >= 0) return { start, end: fmt(ne) };
        return { start, end };
      }
      if (d.subId === null) updateTask(d.taskId, (t) => ({ ...t, ...apply(t.start, t.end) }));
      else updateSub(d.taskId, d.subId, (s) => ({ ...s, ...apply(s.start, s.end) }));
    }
    function onUp() { dragRef.current = null; }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dayWidth, rangeStart]);

  // ---- Row reorder mousemove / mouseup ----
  useEffect(() => {
    function onRowMove(e: MouseEvent) {
      const d = rowDragRef.current;
      if (!d || !scrollContainerRef.current) return;
      const rect = scrollContainerRef.current.getBoundingClientRect();
      const relY = e.clientY - rect.top + scrollContainerRef.current.scrollTop - TOTAL_HEADER_HEIGHT - CONTENT_OFFSET;
      const currentRows = rowsRef.current;

      if (d.type === "task") {
        const taskRows = currentRows.filter((r) => r.type === "task") as (Row & { type: "task" })[];
        let idx = 0;
        for (let i = 0; i < taskRows.length; i++) {
          if (relY > taskRows[i].top + taskRows[i].h / 2) idx = i + 1;
        }
        const lineY = idx < taskRows.length ? taskRows[idx]?.top : (taskRows[taskRows.length - 1]?.top ?? 0) + ROW_HEIGHT;
        dropInsertRef.current = { type: "task", idx };
        setDropLine(lineY ?? 0);
      } else {
        const subRows = currentRows.filter((r) => r.type === "subtask" && r.task.id === d.taskId) as (Row & { type: "subtask" })[];
        let idx = 0;
        for (let i = 0; i < subRows.length; i++) {
          if (relY > subRows[i].top + subRows[i].h / 2) idx = i + 1;
        }
        const lineY = idx < subRows.length ? subRows[idx]?.top : (subRows[subRows.length - 1]?.top ?? 0) + ROW_HEIGHT;
        dropInsertRef.current = { type: "subtask", parentTaskId: d.taskId, idx };
        setDropLine(lineY ?? 0);
      }
    }

    function onRowUp() {
      const d = rowDragRef.current;
      const drop = dropInsertRef.current;
      if (d && drop) {
        if (drop.type === "task") {
          const cur = tasksRef.current;
          const fromIdx = cur.findIndex((t) => t.id === d.taskId);
          if (fromIdx !== -1) {
            const arr = [...cur];
            const [removed] = arr.splice(fromIdx, 1);
            let toIdx = drop.idx;
            if (fromIdx < toIdx) toIdx--;
            arr.splice(toIdx, 0, removed);
            setTasks(arr);
          }
        } else if (drop.type === "subtask" && drop.parentTaskId !== undefined) {
          const parentId = drop.parentTaskId;
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== parentId) return t;
              const fromIdx = t.subtasks.findIndex((s) => s.id === d.subId);
              if (fromIdx === -1) return t;
              const arr = [...t.subtasks];
              const [removed] = arr.splice(fromIdx, 1);
              let toIdx = drop.idx;
              if (fromIdx < toIdx) toIdx--;
              arr.splice(toIdx, 0, removed);
              return { ...t, subtasks: arr };
            })
          );
        }
      }
      rowDragRef.current = null;
      dropInsertRef.current = null;
      setDropLine(null);
    }

    document.addEventListener("mousemove", onRowMove);
    document.addEventListener("mouseup", onRowUp);
    return () => {
      document.removeEventListener("mousemove", onRowMove);
      document.removeEventListener("mouseup", onRowUp);
    };
  }, []);

  function startRowDrag(e: React.MouseEvent, type: "task" | "subtask", taskId: number, subId?: number) {
    e.preventDefault();
    e.stopPropagation();
    setTasks((prev) => { pushUndo(prev); return prev; });
    rowDragRef.current = { type, taskId, subId };
  }

  function startDrag(e: React.MouseEvent, taskId: number, subId: number | null, mode: "move" | "left" | "right", start: string, end: string) {
    e.stopPropagation();
    setTasks((prev) => { pushUndo(prev); return prev; });
    dragRef.current = { taskId, subId, mode, startX: e.clientX, origStart: parseDate(start), origEnd: parseDate(end) };
  }

  // ---- Left panel (담당자/작업/시작일 카드) width resize ----
  const labelDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = labelDragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      setLabelWidth(Math.min(MAX_LABEL_WIDTH, Math.max(MIN_LABEL_WIDTH, d.startWidth + dx)));
    }
    function onUp() {
      labelDragRef.current = null;
      setIsResizingLabel(false);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);
  function startLabelDrag(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    labelDragRef.current = { startX: e.clientX, startWidth: labelWidth };
    setIsResizingLabel(true);
  }

  // ---- Month header ----
  const monthCells = useMemo(() => {
    const cells: { left: number; width: number; label: string }[] = [];
    let i = 0;
    while (i < totalDays) {
      const d = addDays(rangeStart, i);
      const y = d.getFullYear();
      const m = d.getMonth();
      let span = 0;
      let j = i;
      while (j < totalDays) {
        const dd = addDays(rangeStart, j);
        if (dd.getFullYear() === y && dd.getMonth() === m) { span++; j++; }
        else break;
      }
      cells.push({ left: i * dayWidth, width: span * dayWidth, label: `${y}년 ${m + 1}월` });
      i = j;
    }
    return cells;
  }, [rangeStart, totalDays, dayWidth]);

  // ---- Day header cells ----
  const dayCells = useMemo(() => {
    const cells = [];
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(rangeStart, i);
      const isToday = diffDays(today, d) === 0;
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const showLabel = d.getDate() === 1 || i === 0 || d.getDay() === 1;
      cells.push(
        <div
          key={i}
          style={{
            position: "absolute", left: i * dayWidth, top: 0,
            width: dayWidth, height: "100%",
            borderLeft: "0.5px solid #d8d5cc",
            fontSize: 10, color: isWeekend ? "#9a988f" : "#6b6a64",
            paddingTop: 4, textAlign: "center",
            background: isToday ? "#e6f1fb" : undefined,
          }}
        >
          {showLabel ? `${d.getMonth() + 1}/${d.getDate()}` : ""}
        </div>
      );
    }
    return cells;
  }, [rangeStart, totalDays, dayWidth, today]);

  const gridLines = useMemo(() => {
    const lines = [];
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(rangeStart, i);
      const isWk = d.getDay() === 0 || d.getDay() === 6;
      const isToday = diffDays(today, d) === 0;
      lines.push(
        <div
          key={i}
          style={{
            position: "absolute", left: leftWidth + i * dayWidth, top: 0,
            width: dayWidth, height: totalHeight,
            borderLeft: "0.5px solid #d8d5cc",
            pointerEvents: "none",
            background: isToday ? "#e6f1fb55" : isWk ? "#f1efe8" : undefined,
          }}
        />
      );
    }
    return lines;
  }, [rangeStart, totalDays, dayWidth, totalHeight, leftWidth, today]);

  // ---- Dependency arrows (SVG) ----
  const arrowPaths = useMemo(() => {
    const paths: { d: string; key: string }[] = [];
    tasks.forEach((task) => {
      const targetRow = taskRowMap.get(task.id);
      if (!targetRow) return;
      const tStart = parseDate(task.start);
      const targetX = leftWidth + diffDays(rangeStart, tStart) * dayWidth;
      const targetY = targetRow.top + CONTENT_OFFSET + ROW_HEIGHT / 2;

      task.dependsOn.forEach((depId) => {
        const srcRow = taskRowMap.get(depId);
        const srcTask = tasks.find((t) => t.id === depId);
        if (!srcRow || !srcTask) return;
        const sEnd = parseDate(srcTask.end);
        const srcX = leftWidth + (diffDays(rangeStart, sEnd) + 1) * dayWidth;
        const srcY = srcRow.top + CONTENT_OFFSET + ROW_HEIGHT / 2;
        const mx = srcX + Math.max(8, (targetX - srcX) * 0.4);
        const d = `M${srcX},${srcY} C${mx},${srcY} ${mx},${targetY} ${targetX},${targetY}`;
        paths.push({ d, key: `${depId}-${task.id}` });
      });
    });
    return paths;
  }, [tasks, taskRowMap, rangeStart, dayWidth, leftWidth]);

  function shapeIcon(shape: Shape) {
    if (shape === "rect") return "▭";
    if (shape === "pill") return "⬭";
    return "◆";
  }

  const btnStyle: React.CSSProperties = { height: 30, padding: "0 10px", cursor: "pointer" };

  return (
    <div style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
      {/* ---- Toolbar ---- */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text" placeholder="새 작업 이름" value={newTaskName}
            onChange={(e) => setNewTaskName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
            style={{ width: 160, height: 30, padding: "0 8px" }}
          />
          <button onClick={addTask} style={btnStyle}>+ 작업 추가</button>
          <button onClick={undo} style={btnStyle} title="실행취소 (Ctrl+Z)">↩ 실행취소</button>
          <button onClick={exportCSV} style={btnStyle} title="CSV로 저장">📄 CSV</button>
          <button onClick={exportPNG} style={btnStyle} title="이미지로 저장">🖼 PNG</button>
          {linkSource !== null && (
            <span style={{ color: "#185fa5", fontSize: 12 }}>
              연결할 대상 태스크를 클릭하세요 (취소: 같은 태스크 클릭)
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {/* Range navigation */}
          <button onClick={() => setRangeOffset((o) => o - 30)} style={{ ...btnStyle, padding: "0 8px" }} title="이전 달">◀</button>
          <button onClick={() => setRangeOffset(-7)} style={{ ...btnStyle, padding: "0 8px" }} title="오늘로">오늘</button>
          <button onClick={() => setRangeOffset((o) => o + 30)} style={{ ...btnStyle, padding: "0 8px" }} title="다음 달">▶</button>
          {/* Day range */}
          <select
            value={totalDays}
            onChange={(e) => setTotalDays(Number(e.target.value))}
            style={{ height: 30, padding: "0 4px" }}
          >
            <option value={30}>30일</option>
            <option value={60}>60일</option>
            <option value={90}>90일</option>
            <option value={180}>180일</option>
            <option value={365}>365일</option>
          </select>
          {/* Zoom */}
          <button aria-label="좁게" onClick={() => setDayWidth((w) => Math.max(16, w - 8))} style={{ width: 30, height: 30 }}>−</button>
          <button aria-label="넓게" onClick={() => setDayWidth((w) => Math.min(60, w + 8))} style={{ width: 30, height: 30 }}>+</button>
        </div>
      </div>

      {/* ---- Legend ---- */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 10, fontSize: 12, color: "#6b6a64" }}>
        {RAINBOW.map((col, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: col.bg, flexShrink: 0 }} />
            {LEGEND_LABELS[i]}
          </span>
        ))}
      </div>

      {/* ---- Chart ---- */}
      <div
        ref={(el: HTMLDivElement | null) => { chartRef.current = el; scrollContainerRef.current = el; }}
        style={{ border: "0.5px solid #d8d5cc", borderRadius: 8, overflow: "auto", maxHeight: 600 }}
      >
        <div style={{ position: "relative", width: fullWidth, minHeight: TOTAL_HEADER_HEIGHT + totalHeight + 24 }}>

          {/* Sticky header */}
          <div style={{ position: "sticky", top: 0, zIndex: 4, background: "#fff", borderBottom: "0.5px solid #d8d5cc" }}>
            {/* Left panel header */}
            <div style={{ position: "absolute", left: 0, top: 0, width: leftWidth, height: TOTAL_HEADER_HEIGHT, background: "#fff", zIndex: 5, borderRight: "0.5px solid #d8d5cc", display: "flex", alignItems: "flex-end" }}>
              <div style={{ width: ASSIGNEE_WIDTH, padding: "4px 10px", fontWeight: 500, color: "#6b6a64", borderRight: "0.5px solid #d8d5cc", height: DAY_ROW_HEIGHT, display: "flex", alignItems: "center" }}>담당자</div>
              <div style={{ width: labelWidth, padding: "4px 10px", fontWeight: 500, color: "#6b6a64", borderRight: "0.5px solid #d8d5cc", height: DAY_ROW_HEIGHT, display: "flex", alignItems: "center" }}>작업 / 세부 일정</div>
              <div style={{ width: DATE_COL_WIDTH, padding: "4px 10px", fontWeight: 500, color: "#6b6a64", height: DAY_ROW_HEIGHT, display: "flex", alignItems: "center" }}>시작일 / 종료일</div>
            </div>

            {/* Drag to resize the whole left card (담당자/작업/시작일) wider or narrower */}
            <div
              onMouseDown={startLabelDrag}
              title="드래그해서 왼쪽 카드 크기 조절"
              className={`label-resize-handle${isResizingLabel ? " active" : ""}`}
              style={{ position: "absolute", left: leftWidth - 3, top: 0, width: 6, height: TOTAL_HEADER_HEIGHT, zIndex: 6, cursor: "col-resize" }}
            />

            {/* Month + day header */}
            <div style={{ position: "relative", marginLeft: leftWidth, height: TOTAL_HEADER_HEIGHT, width: totalDays * dayWidth }}>
              {/* Month row */}
              <div style={{ position: "absolute", top: 0, left: 0, height: MONTH_ROW_HEIGHT, width: totalDays * dayWidth, background: "#f8f7f4", borderBottom: "0.5px solid #d8d5cc" }}>
                {monthCells.map((mc, i) => (
                  <div key={i} style={{ position: "absolute", left: mc.left, top: 0, width: mc.width, height: MONTH_ROW_HEIGHT, fontSize: 10, fontWeight: 600, color: "#4a4843", padding: "3px 4px", borderLeft: "0.5px solid #d8d5cc", overflow: "hidden", whiteSpace: "nowrap", boxSizing: "border-box" }}>
                    {mc.label}
                  </div>
                ))}
              </div>
              {/* Day row */}
              <div style={{ position: "absolute", top: MONTH_ROW_HEIGHT, left: 0, height: DAY_ROW_HEIGHT, width: totalDays * dayWidth }}>
                {dayCells}
              </div>
            </div>
          </div>

          {/* Content rows */}
          <div style={{ position: "relative", marginTop: TOTAL_HEADER_HEIGHT }}>
            {gridLines}

            {/* Drop indicator line */}
            {dropLine !== null && (
              <div style={{ position: "absolute", left: 0, top: dropLine + CONTENT_OFFSET, width: leftWidth, height: 2, background: "#1E88E5", zIndex: 10, pointerEvents: "none", borderRadius: 1 }} />
            )}

            {/* Dependency arrows SVG */}
            <svg
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: totalHeight, pointerEvents: "none", zIndex: 3, overflow: "visible" }}
            >
              <defs>
                <marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#888" />
                </marker>
              </defs>
              {arrowPaths.map(({ d, key }) => (
                <path key={key} d={d} fill="none" stroke="#888" strokeWidth="1.5" strokeDasharray="4 2" markerEnd="url(#arrow)" />
              ))}
            </svg>

            {/* Left panel + bars */}
            {rows.map((row, idx) => {
              const top = row.top + CONTENT_OFFSET;

              // ---- MEMO row ----
              if (row.type === "memo") {
                const target = row.sub ?? row.task;
                const onMemoChange = (val: string) => {
                  if (row.sub) updateSub(row.task.id, row.sub.id, (s) => ({ ...s, memo: val }));
                  else updateTask(row.task.id, (t) => ({ ...t, memo: val }));
                };
                return (
                  <div key={`row-${idx}`} style={{ position: "absolute", left: 0, top, width: fullWidth, height: row.h, borderBottom: "0.5px solid #d8d5cc", background: "#f1efe8", zIndex: 1, padding: 8, boxSizing: "border-box" }}>
                    <div style={{ width: leftWidth - 16, height: MEMO_HEIGHT - 16, border: "2.5px dashed #b4b2a9", borderRadius: 4, boxSizing: "border-box", background: "#fff", overflow: "hidden" }}>
                      <textarea
                        value={target.memo}
                        placeholder="메모를 입력하세요"
                        onChange={(e) => onMemoChange(e.target.value)}
                        style={{ width: "100%", height: "100%", fontSize: 11, resize: "none", padding: "5px 7px", boxSizing: "border-box", border: "none", outline: "none", background: "transparent", display: "block" }}
                      />
                    </div>
                  </div>
                );
              }

              // ---- COMMENT row ----
              if (row.type === "comment") {
                return (
                  <div key={`row-${idx}`} style={{ position: "absolute", left: 0, top, width: fullWidth, height: row.h, borderBottom: "0.5px solid #d8d5cc", background: "#e6f1fb", zIndex: 1, padding: 8, boxSizing: "border-box" }}>
                    <div style={{ width: leftWidth - 16, height: MEMO_HEIGHT - 16, border: "2px dashed #185fa5", borderRadius: 6, boxSizing: "border-box", background: "#fff", overflow: "hidden", display: "flex", flexDirection: "column", gap: 2, padding: "6px 8px" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#185fa5", flexShrink: 0 }}>Comment</div>
                      <textarea
                        value={row.sub.comment}
                        placeholder="코멘트를 입력하세요"
                        onChange={(e) => updateSub(row.task.id, row.sub.id, (s) => ({ ...s, comment: e.target.value }))}
                        style={{ flex: 1, width: "100%", fontSize: 11, resize: "none", padding: 0, boxSizing: "border-box", border: "none", outline: "none", background: "transparent", display: "block" }}
                      />
                    </div>
                  </div>
                );
              }

              // ---- ADDSUB row ----
              if (row.type === "addsub") {
                return (
                  <div key={`row-${idx}`}>
                    <div style={{ position: "absolute", left: 0, top, width: ASSIGNEE_WIDTH, height: row.h, borderBottom: "0.5px solid #d8d5cc", borderRight: "0.5px solid #d8d5cc", background: "#f1efe8", zIndex: 1, boxSizing: "border-box" }} />
                    <div style={{ position: "absolute", left: ASSIGNEE_WIDTH, top, width: labelWidth + DATE_COL_WIDTH, height: row.h, display: "flex", alignItems: "center", padding: "0 6px 0 30px", borderBottom: "0.5px solid #d8d5cc", background: "#f1efe8", zIndex: 1, boxSizing: "border-box" }}>
                      <button onClick={() => addSub(row.task.id)} style={{ fontSize: 11, padding: "2px 8px", height: 24 }}>+ 세부 일정 추가</button>
                    </div>
                  </div>
                );
              }

              // ---- TASK row ----
              if (row.type === "task") {
                const t = row.task;
                const hasSub = t.subtasks.length > 0;
                const memoActive = t.memoOpen || t.memo.length > 0;
                const isLinkSrc = linkSource === t.id;
                const bg = isLinkSrc ? "#e6f1fb" : "#fff";
                return (
                  <div key={`row-${idx}`}>
                    {/* Assignee */}
                    <div style={{ position: "absolute", left: 0, top, width: ASSIGNEE_WIDTH, height: row.h, display: "flex", alignItems: "center", padding: "0 6px", borderBottom: "0.5px solid #d8d5cc", borderRight: "0.5px solid #d8d5cc", background: bg, zIndex: 1, boxSizing: "border-box" }}>
                      <input type="text" value={t.assignee} placeholder="이름" onChange={(e) => updateTask(t.id, (tt) => ({ ...tt, assignee: e.target.value }))} style={{ width: "100%", height: 26, fontSize: 12, padding: "0 6px" }} />
                    </div>
                    {/* Label */}
                    <div style={{ position: "absolute", left: ASSIGNEE_WIDTH, top, width: labelWidth, height: row.h, display: "flex", alignItems: "center", gap: 2, padding: "0 4px", borderBottom: "0.5px solid #d8d5cc", background: bg, zIndex: 1, boxSizing: "border-box" }}>
                      <span onMouseDown={(e) => startRowDrag(e, "task", t.id)} style={{ cursor: "grab", color: "#ccc", fontSize: 14, flexShrink: 0, userSelect: "none", padding: "0 2px" }} title="드래그해서 순서 변경">⠿</span>
                      <button disabled={!hasSub} onClick={() => toggleExpanded(t.id)} style={{ width: 22, height: 22, padding: 0, border: "none", background: "transparent", flexShrink: 0 }}>
                        {hasSub ? (t.expanded ? "▾" : "▸") : "·"}
                      </button>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, fontWeight: 500 }}>{row.num}. {t.name}</span>
                      <button onClick={() => toggleTaskMemo(t.id)} title="메모" style={{ width: 20, height: 20, padding: 0, borderRadius: "50%", flexShrink: 0, color: memoActive ? "#185fa5" : "#9a988f" }}>🗒</button>
                      <button onClick={() => handleLinkClick(t.id)} title={isLinkSrc ? "연결 취소" : "의존 관계 연결"} style={{ width: 20, height: 20, padding: 0, borderRadius: "50%", flexShrink: 0, background: isLinkSrc ? "#185fa5" : undefined, color: isLinkSrc ? "#fff" : "#9a988f" }}>→</button>
                      <button onClick={() => deleteTask(t.id)} style={{ width: 20, height: 20, padding: 0, borderRadius: "50%", flexShrink: 0 }}>✕</button>
                    </div>
                    {/* Date inputs */}
                    <div style={{ position: "absolute", left: ASSIGNEE_WIDTH + labelWidth, top, width: DATE_COL_WIDTH, height: row.h, display: "flex", alignItems: "center", gap: 4, padding: "0 6px", borderBottom: "0.5px solid #d8d5cc", background: bg, zIndex: 1, boxSizing: "border-box", flexWrap: "wrap", alignContent: "flex-start" }}>
                      <DateField value={t.start} max={t.end} onChange={(v) => updateTask(t.id, (tt) => ({ ...tt, start: v }))} />
                      <span style={{ color: "#9a988f", fontSize: 10 }}>~</span>
                      <DateField value={t.end} min={t.start} onChange={(v) => updateTask(t.id, (tt) => ({ ...tt, end: v }))} />
                      {t.dependsOn.length > 0 && (
                        <div style={{ fontSize: 10, color: "#888", display: "flex", gap: 2, flexWrap: "wrap", width: "100%", marginTop: 2 }}>
                          {t.dependsOn.map((depId) => {
                            const depTask = tasks.find((tt) => tt.id === depId);
                            return (
                              <span key={depId} style={{ background: "#f0f0f0", borderRadius: 3, padding: "1px 3px", cursor: "pointer" }} onClick={() => removeDep(t.id, depId)} title="클릭해서 제거">
                                ↖{depTask?.name.slice(0, 4) ?? depId}✕
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              // ---- SUBTASK row ----
              const memoActiveS = row.sub.memoOpen || row.sub.memo.length > 0;
              const commentActiveS = row.sub.commentOpen || row.sub.comment.length > 0;
              return (
                <div key={`row-${idx}`}>
                  <div style={{ position: "absolute", left: 0, top, width: ASSIGNEE_WIDTH, height: row.h, borderBottom: "0.5px solid #d8d5cc", borderRight: "0.5px solid #d8d5cc", background: "#f1efe8", zIndex: 1, boxSizing: "border-box" }} />
                  <div style={{ position: "absolute", left: ASSIGNEE_WIDTH, top, width: labelWidth, height: row.h, display: "flex", alignItems: "center", gap: 2, padding: "0 4px 0 8px", borderBottom: "0.5px solid #d8d5cc", background: "#f1efe8", zIndex: 1, boxSizing: "border-box" }}>
                    <span onMouseDown={(e) => startRowDrag(e, "subtask", row.task.id, row.sub.id)} style={{ cursor: "grab", color: "#ccc", fontSize: 14, flexShrink: 0, userSelect: "none", padding: "0 2px" }} title="드래그해서 순서 변경">⠿</span>
                    <input
                      type="text"
                      className="subname-input"
                      value={row.sub.name}
                      onChange={(e) => updateSub(row.task.id, row.sub.id, (s) => ({ ...s, name: e.target.value }))}
                      style={{ flex: 1, minWidth: 0, height: 22, fontSize: 12, color: "#6b6a64", padding: "0 4px" }}
                    />
                    <button onClick={() => toggleSubMemo(row.task.id, row.sub.id)} title="메모" style={{ width: 20, height: 20, padding: 0, borderRadius: "50%", flexShrink: 0, color: memoActiveS ? "#185fa5" : "#9a988f" }}>🗒</button>
                    <button onClick={() => toggleSubComment(row.task.id, row.sub.id)} title="코멘트" style={{ width: 20, height: 20, padding: 0, borderRadius: "50%", flexShrink: 0, color: commentActiveS ? "#185fa5" : "#9a988f" }}>✓</button>
                    <button onClick={() => deleteSub(row.task.id, row.sub.id)} style={{ width: 20, height: 20, padding: 0, borderRadius: "50%", flexShrink: 0 }}>✕</button>
                  </div>
                  {/* Date inputs for subtask */}
                  <div style={{ position: "absolute", left: ASSIGNEE_WIDTH + labelWidth, top, width: DATE_COL_WIDTH, height: row.h, display: "flex", alignItems: "center", gap: 4, padding: "0 6px", borderBottom: "0.5px solid #d8d5cc", background: "#f1efe8", zIndex: 1, boxSizing: "border-box" }}>
                    <DateField value={row.sub.start} max={row.sub.end} onChange={(v) => updateSub(row.task.id, row.sub.id, (s) => ({ ...s, start: v }))} />
                    <span style={{ color: "#9a988f", fontSize: 10 }}>~</span>
                    <DateField value={row.sub.end} min={row.sub.start} onChange={(v) => updateSub(row.task.id, row.sub.id, (s) => ({ ...s, end: v }))} />
                  </div>
                </div>
              );
            })}

            {/* Bars */}
            {rows.map((row, idx) => {
              if (row.type === "addsub" || row.type === "memo" || row.type === "comment") return null;
              const isSub = row.type === "subtask";
              const dataObj: SubTask = isSub ? row.sub : row.task;
              const rowTop = row.top + CONTENT_OFFSET;
              const s = parseDate(dataObj.start);
              const e = parseDate(dataObj.end);
              const left = leftWidth + diffDays(rangeStart, s) * dayWidth;
              const w = Math.max((diffDays(s, e) + 1) * dayWidth, dayWidth / 2);
              const col = RAINBOW[dataObj.colorIdx % RAINBOW.length];
              const shape = dataObj.shape;
              const barH = isSub ? ROW_HEIGHT - 18 : ROW_HEIGHT - 12;
              const top2 = rowTop + (isSub ? 9 : 6);
              const radius = shape === "pill" ? 999 : 6;
              const taskId = row.task.id;
              const subId = isSub ? row.sub.id : null;
              const labelText = isSub ? dataObj.name : `${(row as { num: number }).num}. ${dataObj.name}`;

              return (
                <div key={`bar-${idx}`}>
                  {shape === "diamond" ? (
                    <>
                      <div style={{ position: "absolute", left: left - (isSub ? 8 : 10), top: top2 + barH / 2 - (isSub ? 8 : 10), width: isSub ? 16 : 20, height: isSub ? 16 : 20, background: col.bg, transform: "rotate(45deg)", borderRadius: 3 }} />
                      <div style={{ position: "absolute", left: left + (isSub ? 8 : 10) + 6, top: top2, height: barH, display: "flex", alignItems: "center", fontSize: isSub ? 10 : 11, color: "#6b6a64", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {labelText}
                      </div>
                    </>
                  ) : (
                    <div
                      onMouseDown={(e) => startDrag(e, taskId, subId, "move", dataObj.start, dataObj.end)}
                      style={{ position: "absolute", left, top: top2, width: w, height: barH, background: col.bg, borderRadius: radius, display: "flex", alignItems: "center", cursor: "grab", userSelect: "none", zIndex: 2 }}
                    >
                      <div onMouseDown={(e) => startDrag(e, taskId, subId, "left", dataObj.start, dataObj.end)} style={{ width: 8, height: "100%", cursor: "ew-resize", flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: isSub ? 10 : 11, color: col.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", padding: "0 2px" }}>{labelText}</span>
                      <div onMouseDown={(e) => startDrag(e, taskId, subId, "right", dataObj.start, dataObj.end)} style={{ width: 8, height: "100%", cursor: "ew-resize", flexShrink: 0 }} />
                    </div>
                  )}
                  <button onClick={() => cycleShape(taskId, subId)} aria-label="도형" style={{ position: "absolute", left, top: top2 - 16, width: 14, height: 14, padding: 0, borderRadius: "50%", background: "#fff", zIndex: 4, fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
                    {shapeIcon(shape)}
                  </button>
                  <button onClick={() => cycleColor(taskId, subId)} aria-label="색상" style={{ position: "absolute", left: left + 16, top: top2 - 16, width: 14, height: 14, padding: 0, borderRadius: "50%", background: col.bg, zIndex: 4, border: "0.5px solid #d8d5cc" }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p style={{ color: "#9a988f", fontSize: 12, marginTop: 10 }}>
        막대를 드래그해 일정 이동 · 양 끝 드래그로 기간 조정 · <strong>→</strong> 버튼으로 의존 관계 연결 · 의존 태그 클릭으로 제거 · 데이터는 브라우저에 자동 저장됩니다.
      </p>
    </div>
  );
}
