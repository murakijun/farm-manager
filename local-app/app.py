#!/usr/bin/env python3
"""
農場 木管理システム
起動: python3 app.py
ブラウザ: http://localhost:5100
"""
import os
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

from flask import (Flask, flash, jsonify, redirect, render_template,
                   request, send_from_directory, url_for)
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "farm.db"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp", "heic"}

app = Flask(__name__)
app.secret_key = "farm-manager-secret-2024"
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20MB


# ── DB ──────────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS houses (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            name    TEXT NOT NULL,
            rows    INTEGER NOT NULL DEFAULT 5,
            cols    INTEGER NOT NULL DEFAULT 10,
            notes   TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS trees (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            house_id   INTEGER NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
            row_num    INTEGER NOT NULL,
            col_num    INTEGER NOT NULL,
            label      TEXT DEFAULT '',
            variety    TEXT DEFAULT '',
            status     TEXT DEFAULT 'normal',
            notes      TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(house_id, row_num, col_num)
        );

        CREATE TABLE IF NOT EXISTS photos (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            tree_id    INTEGER NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
            filename   TEXT NOT NULL,
            caption    TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS work_records (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            house_id     INTEGER NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
            work_name    TEXT NOT NULL,
            work_type    TEXT DEFAULT 'pesticide',
            scheduled_at TEXT DEFAULT '',
            notes        TEXT DEFAULT '',
            created_at   TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS tree_work (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            work_record_id INTEGER NOT NULL REFERENCES work_records(id) ON DELETE CASCADE,
            tree_id        INTEGER NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
            completed      INTEGER DEFAULT 0,
            completed_at   TEXT DEFAULT '',
            UNIQUE(work_record_id, tree_id)
        );
        """)


# ── helpers ─────────────────────────────────────────────────────────────────

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def ensure_trees(house_id, rows, cols):
    """ハウスのグリッド分だけ木レコードを作る（なければ）"""
    with get_db() as db:
        for r in range(1, rows + 1):
            for c in range(1, cols + 1):
                db.execute(
                    "INSERT OR IGNORE INTO trees (house_id, row_num, col_num) VALUES (?,?,?)",
                    (house_id, r, c)
                )


# ── routes: index ────────────────────────────────────────────────────────────

@app.route("/")
def index():
    with get_db() as db:
        houses = db.execute(
            "SELECT *, rows*cols AS total FROM houses ORDER BY id"
        ).fetchall()
    return render_template("index.html", houses=houses)


# ── routes: houses ───────────────────────────────────────────────────────────

@app.route("/houses/new", methods=["GET", "POST"])
def house_new():
    if request.method == "POST":
        name = request.form["name"].strip()
        rows = int(request.form.get("rows", 5))
        cols = int(request.form.get("cols", 10))
        notes = request.form.get("notes", "")
        if not name:
            flash("ハウス名を入力してください", "danger")
            return redirect(url_for("house_new"))
        with get_db() as db:
            cur = db.execute(
                "INSERT INTO houses (name, rows, cols, notes) VALUES (?,?,?,?)",
                (name, rows, cols, notes)
            )
            house_id = cur.lastrowid
        ensure_trees(house_id, rows, cols)
        flash(f"ハウス「{name}」を作成しました", "success")
        return redirect(url_for("house_detail", house_id=house_id))
    return render_template("house_form.html", house=None)


@app.route("/houses/<int:house_id>")
def house_detail(house_id):
    with get_db() as db:
        house = db.execute("SELECT * FROM houses WHERE id=?", (house_id,)).fetchone()
        if not house:
            flash("ハウスが見つかりません", "danger")
            return redirect(url_for("index"))
        trees = db.execute(
            "SELECT * FROM trees WHERE house_id=? ORDER BY row_num, col_num",
            (house_id,)
        ).fetchall()
        works = db.execute(
            "SELECT * FROM work_records WHERE house_id=? ORDER BY created_at DESC LIMIT 5",
            (house_id,)
        ).fetchall()

    # グリッド形式に整理
    grid = {}
    for t in trees:
        grid[(t["row_num"], t["col_num"])] = t

    return render_template("house_detail.html", house=house, grid=grid, works=works)


@app.route("/houses/<int:house_id>/edit", methods=["GET", "POST"])
def house_edit(house_id):
    with get_db() as db:
        house = db.execute("SELECT * FROM houses WHERE id=?", (house_id,)).fetchone()
    if not house:
        return redirect(url_for("index"))
    if request.method == "POST":
        name = request.form["name"].strip()
        notes = request.form.get("notes", "")
        with get_db() as db:
            db.execute("UPDATE houses SET name=?, notes=? WHERE id=?",
                       (name, notes, house_id))
        flash("保存しました", "success")
        return redirect(url_for("house_detail", house_id=house_id))
    return render_template("house_form.html", house=house)


@app.route("/houses/<int:house_id>/delete", methods=["POST"])
def house_delete(house_id):
    with get_db() as db:
        house = db.execute("SELECT name FROM houses WHERE id=?", (house_id,)).fetchone()
        db.execute("DELETE FROM houses WHERE id=?", (house_id,))
    flash(f"ハウス「{house['name']}」を削除しました", "success")
    return redirect(url_for("index"))


# ── routes: trees ────────────────────────────────────────────────────────────

@app.route("/trees/<int:tree_id>")
def tree_detail(tree_id):
    with get_db() as db:
        tree = db.execute(
            "SELECT t.*, h.name AS house_name, h.id AS house_id FROM trees t "
            "JOIN houses h ON h.id = t.house_id WHERE t.id=?", (tree_id,)
        ).fetchone()
        if not tree:
            flash("木が見つかりません", "danger")
            return redirect(url_for("index"))
        photos = db.execute(
            "SELECT * FROM photos WHERE tree_id=? ORDER BY created_at DESC",
            (tree_id,)
        ).fetchall()
        work_statuses = db.execute(
            """SELECT tw.*, wr.work_name, wr.work_type, wr.scheduled_at
               FROM tree_work tw
               JOIN work_records wr ON wr.id = tw.work_record_id
               WHERE tw.tree_id=?
               ORDER BY wr.created_at DESC""",
            (tree_id,)
        ).fetchall()
    return render_template("tree_detail.html", tree=tree, photos=photos,
                           work_statuses=work_statuses)


@app.route("/trees/<int:tree_id>/edit", methods=["POST"])
def tree_edit(tree_id):
    label = request.form.get("label", "")
    variety = request.form.get("variety", "")
    status = request.form.get("status", "normal")
    notes = request.form.get("notes", "")
    with get_db() as db:
        db.execute(
            "UPDATE trees SET label=?, variety=?, status=?, notes=? WHERE id=?",
            (label, variety, status, notes, tree_id)
        )
        tree = db.execute(
            "SELECT house_id FROM trees WHERE id=?", (tree_id,)
        ).fetchone()
    flash("保存しました", "success")
    return redirect(url_for("tree_detail", tree_id=tree_id))


# ── routes: photos ───────────────────────────────────────────────────────────

@app.route("/trees/<int:tree_id>/photos", methods=["POST"])
def photo_upload(tree_id):
    file = request.files.get("photo")
    caption = request.form.get("caption", "")
    if not file or not allowed_file(file.filename):
        flash("画像ファイルを選択してください（jpg/png/gif/webp/heic）", "danger")
        return redirect(url_for("tree_detail", tree_id=tree_id))
    ext = file.filename.rsplit(".", 1)[1].lower()
    filename = f"{uuid.uuid4().hex}.{ext}"
    file.save(UPLOAD_DIR / filename)
    with get_db() as db:
        db.execute(
            "INSERT INTO photos (tree_id, filename, caption) VALUES (?,?,?)",
            (tree_id, filename, caption)
        )
    flash("写真を追加しました", "success")
    return redirect(url_for("tree_detail", tree_id=tree_id))


@app.route("/photos/<int:photo_id>/delete", methods=["POST"])
def photo_delete(photo_id):
    with get_db() as db:
        photo = db.execute("SELECT * FROM photos WHERE id=?", (photo_id,)).fetchone()
        if photo:
            try:
                (UPLOAD_DIR / photo["filename"]).unlink()
            except FileNotFoundError:
                pass
            db.execute("DELETE FROM photos WHERE id=?", (photo_id,))
            tree_id = photo["tree_id"]
    flash("写真を削除しました", "success")
    return redirect(url_for("tree_detail", tree_id=tree_id))


@app.route("/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


# ── routes: work records ─────────────────────────────────────────────────────

@app.route("/houses/<int:house_id>/work/new", methods=["GET", "POST"])
def work_new(house_id):
    with get_db() as db:
        house = db.execute("SELECT * FROM houses WHERE id=?", (house_id,)).fetchone()
    if not house:
        return redirect(url_for("index"))
    if request.method == "POST":
        work_name = request.form["work_name"].strip()
        work_type = request.form.get("work_type", "pesticide")
        scheduled_at = request.form.get("scheduled_at", "")
        notes = request.form.get("notes", "")
        if not work_name:
            flash("作業名を入力してください", "danger")
            return redirect(url_for("work_new", house_id=house_id))
        with get_db() as db:
            cur = db.execute(
                "INSERT INTO work_records (house_id, work_name, work_type, scheduled_at, notes) "
                "VALUES (?,?,?,?,?)",
                (house_id, work_name, work_type, scheduled_at, notes)
            )
            work_id = cur.lastrowid
            # 全ての木に未完了レコードを追加
            trees = db.execute(
                "SELECT id FROM trees WHERE house_id=?", (house_id,)
            ).fetchall()
            for t in trees:
                db.execute(
                    "INSERT OR IGNORE INTO tree_work (work_record_id, tree_id) VALUES (?,?)",
                    (work_id, t["id"])
                )
        flash(f"作業「{work_name}」を作成しました", "success")
        return redirect(url_for("work_detail", house_id=house_id, work_id=work_id))
    return render_template("work_form.html", house=house)


@app.route("/houses/<int:house_id>/work/<int:work_id>")
def work_detail(house_id, work_id):
    with get_db() as db:
        house = db.execute("SELECT * FROM houses WHERE id=?", (house_id,)).fetchone()
        work = db.execute("SELECT * FROM work_records WHERE id=? AND house_id=?",
                          (work_id, house_id)).fetchone()
        if not work:
            flash("作業記録が見つかりません", "danger")
            return redirect(url_for("house_detail", house_id=house_id))
        rows = db.execute(
            """SELECT tw.*, t.row_num, t.col_num, t.label, t.variety, t.status
               FROM tree_work tw
               JOIN trees t ON t.id = tw.tree_id
               WHERE tw.work_record_id=?
               ORDER BY t.row_num, t.col_num""",
            (work_id,)
        ).fetchall()
        total = len(rows)
        done = sum(1 for r in rows if r["completed"])

        grid = {}
        for r in rows:
            grid[(r["row_num"], r["col_num"])] = r

    return render_template("work_detail.html", house=house, work=work,
                           grid=grid, total=total, done=done)


@app.route("/work/<int:work_id>/toggle/<int:tree_id>", methods=["POST"])
def work_toggle(work_id, tree_id):
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM tree_work WHERE work_record_id=? AND tree_id=?",
            (work_id, tree_id)
        ).fetchone()
        if row:
            new_val = 0 if row["completed"] else 1
            now = datetime.now().strftime("%Y-%m-%d %H:%M") if new_val else ""
            db.execute(
                "UPDATE tree_work SET completed=?, completed_at=? "
                "WHERE work_record_id=? AND tree_id=?",
                (new_val, now, work_id, tree_id)
            )
        work = db.execute(
            "SELECT house_id FROM work_records WHERE id=?", (work_id,)
        ).fetchone()
    return redirect(url_for("work_detail", house_id=work["house_id"], work_id=work_id))


@app.route("/work/<int:work_id>/delete", methods=["POST"])
def work_delete(work_id):
    with get_db() as db:
        work = db.execute("SELECT * FROM work_records WHERE id=?", (work_id,)).fetchone()
        db.execute("DELETE FROM work_records WHERE id=?", (work_id,))
    flash(f"作業「{work['work_name']}」を削除しました", "success")
    return redirect(url_for("house_detail", house_id=work["house_id"]))


# ── API: 一括チェック ─────────────────────────────────────────────────────────

@app.route("/work/<int:work_id>/check_all", methods=["POST"])
def work_check_all(work_id):
    completed = int(request.form.get("completed", 1))
    now = datetime.now().strftime("%Y-%m-%d %H:%M") if completed else ""
    with get_db() as db:
        db.execute(
            "UPDATE tree_work SET completed=?, completed_at=? WHERE work_record_id=?",
            (completed, now, work_id)
        )
        work = db.execute("SELECT house_id FROM work_records WHERE id=?", (work_id,)).fetchone()
    return redirect(url_for("work_detail", house_id=work["house_id"], work_id=work_id))


# ── main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("=" * 50)
    print("  農場 木管理システム 起動中...")
    print("  ブラウザで開く: http://localhost:5100")
    print("  終了: Ctrl+C")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5100, debug=False)
