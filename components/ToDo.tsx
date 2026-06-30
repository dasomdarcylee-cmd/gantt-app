"use client";

import React, { useEffect, useState } from "react";

type Todo = { id: number; text: string; completed: boolean; createdAt: string };

const STORAGE_KEY = "todo-v1";

export default function ToDo() {
  const [items, setItems] = useState<Todo[]>([]);
  const [text, setText] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }, [items]);

  function add() {
    const v = text.trim();
    if (!v) return;
    const next: Todo = { id: Date.now(), text: v, completed: false, createdAt: new Date().toISOString() };
    setItems((s) => [next, ...s]);
    setText("");
  }

  function toggle(id: number) {
    setItems((s) => s.map((it) => (it.id === id ? { ...it, completed: !it.completed } : it)));
  }

  function remove(id: number) {
    setItems((s) => s.filter((it) => it.id !== id));
  }

  function clearCompleted() {
    setItems((s) => s.filter((it) => !it.completed));
  }

  return (
    <div className="todo-container">
      <div className="todo-header">
        <h1 className="todo-title">할 일 목록</h1>
        <p className="todo-sub">간단하고 모바일 친화적인 To Do 리스트입니다.</p>
      </div>

      <div className="todo-input-row">
        <input
          className="todo-input"
          placeholder="새 작업을 입력하세요"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <button className="todo-add-btn" onClick={add} aria-label="추가">추가</button>
      </div>

      <div className="todo-stats">
        <span>{items.filter((i) => !i.completed).length}개 남음</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={clearCompleted} className="todo-clear-btn">완료된 항목 삭제</button>
        </div>
      </div>

      <ul className="todo-list">
        {items.map((it) => (
          <li key={it.id} className={`todo-item ${it.completed ? "done" : ""}`}>
            <label className="todo-left">
              <input className="todo-checkbox" type="checkbox" checked={it.completed} onChange={() => toggle(it.id)} />
              <span className="todo-text">{it.text}</span>
            </label>
            <button className="todo-delete" onClick={() => remove(it.id)} aria-label="삭제">✕</button>
          </li>
        ))}
      </ul>

      <p className="todo-hint">데이터는 브라우저에 저장됩니다.</p>
    </div>
  );
}
