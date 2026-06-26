import json, hashlib, time
from pathlib import Path
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
STATIC_DIR = Path(__file__).parent

def _load(name):
    p = DATA_DIR / name
    if p.exists(): return json.loads(p.read_text())
    return {}

def _save(name, data):
    p = DATA_DIR / name
    p.write_text(json.dumps(data, ensure_ascii=False))

def _hash_pw(pw): return hashlib.sha256(pw.encode()).hexdigest()

def _list_user_files(username):
    """List all data files for a user"""
    files = {}
    for suffix in ["_practice.json", "_exam.json", "_wrongbook.json", "_stats.json"]:
        fname = f"{username}{suffix}"
        p = DATA_DIR / fname
        if p.exists():
            files[fname] = json.loads(p.read_text())
    return files

def _save_user_files(username, files_dict):
    """Restore all data files for a user from a dict"""
    for fname, data in files_dict.items():
        if fname.endswith('.json'):
            (DATA_DIR / fname).write_text(json.dumps(data, ensure_ascii=False))

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class AuthReq(BaseModel):
    username: str
    password: str

@app.post("/api/register")
def register(req: AuthReq):
    if len(req.username) < 3: raise HTTPException(400, "用户名至少3位")
    if len(req.password) < 4: raise HTTPException(400, "密码至少4位")
    users = _load("users.json")
    if req.username in users: raise HTTPException(400, "用户名已存在")
    users[req.username] = {"passwordHash": _hash_pw(req.password), "created": time.time()}
    _save("users.json", users)
    return {"ok": True}

@app.post("/api/login")
def login(req: AuthReq):
    users = _load("users.json")
    if req.username not in users: raise HTTPException(400, "用户不存在")
    if users[req.username]["passwordHash"] != _hash_pw(req.password): raise HTTPException(400, "密码错误")
    return {"ok": True, "username": req.username}

@app.get("/api/practice/{cat}")
def get_practice(cat: str, username: str = Header(alias="X-Username")):
    d = _load(f"{username}_practice.json")
    return d.get(cat, {})

@app.put("/api/practice/{cat}")
def save_practice(cat: str, username: str = Header(alias="X-Username"), data: dict = None):
    d = _load(f"{username}_practice.json")
    d[cat] = data
    _save(f"{username}_practice.json", d)
    return {"ok": True}

@app.get("/api/exam")
def get_exam(username: str = Header(alias="X-Username")):
    return _load(f"{username}_exam.json")

@app.put("/api/exam")
def save_exam(username: str = Header(alias="X-Username"), data: dict = None):
    _save(f"{username}_exam.json", data)
    return {"ok": True}

@app.delete("/api/exam")
def clear_exam(username: str = Header(alias="X-Username")):
    p = DATA_DIR / f"{username}_exam.json"
    if p.exists(): p.write_text("{}")
    return {"ok": True}

@app.get("/api/wrongbook")
def get_wrongbook(username: str = Header(alias="X-Username")):
    return _load(f"{username}_wrongbook.json")

@app.put("/api/wrongbook")
def save_wrongbook(username: str = Header(alias="X-Username"), data: dict = None):
    _save(f"{username}_wrongbook.json", data)
    return {"ok": True}

@app.delete("/api/wrongbook")
def clear_wrongbook(username: str = Header(alias="X-Username")):
    p = DATA_DIR / f"{username}_wrongbook.json"
    if p.exists(): p.write_text("{}")
    return {"ok": True}

@app.get("/api/user-stats")
def get_user_stats(username: str = Header(alias="X-Username")):
    wb = _load(f"{username}_wrongbook.json")
    wrongCount = len(wb)
    totalWrongs = sum(v.get("wrongCount", 0) for v in wb.values())
    user_st = _load(f"{username}_stats.json")
    totalAnswered = user_st.get("totalAnswered", 0)
    if totalAnswered == 0:
        practice = _load(f"{username}_practice.json")
        totalAnswered = sum(len(v.get("answered", {})) for v in practice.values())
    return {"wrongKindCount": wrongCount, "totalWrongs": totalWrongs, "totalAnswered": totalAnswered}

@app.get("/api/global-stats")
def get_global_stats():
    return _load("global_stats.json")

@app.post("/api/record-answer")
def record_answer(data: dict):
    gs = _load("global_stats.json")
    qid = str(data.get("questionId", ""))
    correct = data.get("correct", False)
    if qid not in gs: gs[qid] = {"totalAttempts": 0, "correctAttempts": 0}
    gs[qid]["totalAttempts"] += 1
    if correct: gs[qid]["correctAttempts"] += 1
    _save("global_stats.json", gs)
    username = data.get("username", "")
    if username:
        user_st = _load(f"{username}_stats.json")
        user_st["totalAnswered"] = user_st.get("totalAnswered", 0) + 1
        _save(f"{username}_stats.json", user_st)
    return {"ok": True}

@app.post("/api/record-wrong")
def record_wrong(username: str = Header(alias="X-Username"), data: dict = None):
    wb = _load(f"{username}_wrongbook.json")
    qid = str(data.get("questionId", ""))
    wrong_answer = data.get("wrongAnswer", "")
    if qid not in wb: wb[qid] = {"wrongCount": 0, "lastWrongAnswer": "", "questionId": int(qid)}
    wb[qid]["wrongCount"] += 1
    wb[qid]["lastWrongAnswer"] = wrong_answer
    _save(f"{username}_wrongbook.json", wb)
    return {"ok": True}

@app.post("/api/remove-wrong")
def remove_wrong(username: str = Header(alias="X-Username"), data: dict = None):
    wb = _load(f"{username}_wrongbook.json")
    qid = str(data.get("questionId", ""))
    if qid in wb: del wb[qid]
    _save(f"{username}_wrongbook.json", wb)
    return {"ok": True}

@app.delete("/api/user-data/{username}")
def reset_user_data(username: str):
    for suffix in ["_practice.json", "_exam.json", "_wrongbook.json"]:
        p = DATA_DIR / f"{username}{suffix}"
        if p.exists(): p.write_text("{}")
    return {"ok": True}

# === Data Export / Import APIs ===
@app.get("/api/export-data")
def export_data(username: str = Header(alias="X-Username")):
    """Export all user data as a JSON file download"""
    files = _list_user_files(username)
    export_payload = {
        "username": username,
        "exportTime": time.time(),
        "data": files
    }
    json_str = json.dumps(export_payload, ensure_ascii=False, indent=2)
    return Response(
        content=json_str,
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={username}_backup.json"}
    )

@app.post("/api/import-data")
def import_data(username: str = Header(alias="X-Username"), data: dict = None):
    """Import user data from backup"""
    if not data or "data" not in data:
        raise HTTPException(400, "Invalid backup file format")
    _save_user_files(username, data["data"])
    return {"ok": True, "message": "数据导入成功"}

# Static files
@app.get("/")
def serve_index():
    return FileResponse(STATIC_DIR / "index.html", media_type="text/html")

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
