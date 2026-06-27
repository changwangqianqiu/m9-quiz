import json, hashlib, time, os
from pathlib import Path
from fastapi import FastAPI, HTTPException, Header
from dotenv import load_dotenv
load_dotenv()  # 读取 .env 文件
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

# ========== 配置 ==========
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
USE_CLOUD_DB = bool(SUPABASE_URL and SUPABASE_KEY)

STATIC_DIR = Path(__file__).parent
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# ========== Supabase 客户端 ==========
if USE_CLOUD_DB:
    import httpx
    HEADERS = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    SUPABASE = httpx.Client(base_url=f"{SUPABASE_URL}/rest/v1", headers=HEADERS, timeout=10)

# ========== 工具函数 ==========
def _hash_pw(pw): return hashlib.sha256(pw.encode()).hexdigest()

def _local_load(name):
    p = DATA_DIR / name
    if p.exists(): return json.loads(p.read_text())
    return {}

def _local_save(name, data):
    p = DATA_DIR / name
    p.write_text(json.dumps(data, ensure_ascii=False))

# ========== 云数据库操作 ==========
def db_get(table, filters=None, select="*"):
    """从 Supabase 查询"""
    params = {"select": select}
    if filters:
        for k, v in filters.items():
            params[k] = f"eq.{v}"
    r = SUPABASE.get(f"/{table}", params=params)
    if r.status_code == 200:
        return r.json()
    return []

def db_upsert(table, data):
    """插入或更新"""
    r = SUPABASE.post(f"/{table}", json=data)
    return r.status_code in (200, 201, 204)

def db_delete(table, filters):
    """删除"""
    params = {}
    for k, v in filters.items():
        params[k] = f"eq.{v}"
    r = SUPABASE.delete(f"/{table}", params=params)
    return r.status_code in (200, 201, 204)

def db_rpc(func, params=None):
    """调用 Supabase 存储过程"""
    r = SUPABASE.post(f"/rpc/{func}", json=params or {})
    if r.status_code == 200:
        return r.json()
    return None

# ========== 统一数据层 ==========
def load_data(name, username=None):
    """
    加载数据：优先从云数据库，失败则回退本地文件
    name: 文件名（如 'users.json'）或数据类型（如 'practice'）
    """
    if USE_CLOUD_DB and username:
        try:
            rows = db_get("user_data", {"username": username, "data_key": name}, "data_value")
            if rows:
                return json.loads(rows[0]["data_value"])
        except:
            pass
    # 回退本地
    return _local_load(name)

def save_data(name, data, username=None):
    """保存数据到云数据库（如启用）或本地文件"""
    if USE_CLOUD_DB and username:
        try:
            value_str = json.dumps(data, ensure_ascii=False)
            # 先删后插（upsert）
            db_delete("user_data", {"username": username, "data_key": name})
            db_upsert("user_data", {
                "username": username,
                "data_key": name,
                "data_value": value_str,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            })
            return
        except:
            pass
    _local_save(name, data)

def load_global_data(name):
    """加载全局数据（如 global_stats）"""
    if USE_CLOUD_DB:
        try:
            rows = db_get("global_data", {"data_key": name}, "data_value")
            if rows:
                return json.loads(rows[0]["data_value"])
        except:
            pass
    return _local_load(name)

def save_global_data(name, data):
    """保存全局数据"""
    if USE_CLOUD_DB:
        try:
            value_str = json.dumps(data, ensure_ascii=False)
            db_delete("global_data", {"data_key": name})
            db_upsert("global_data", {
                "data_key": name,
                "data_value": value_str,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            })
            return
        except:
            pass
    _local_save(name, data)

# ========== FastAPI ==========
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class AuthReq(BaseModel):
    username: str
    password: str

@app.post("/api/register")
def register(req: AuthReq):
    if len(req.username) < 3: raise HTTPException(400, "用户名至少3位")
    if len(req.password) < 4: raise HTTPException(400, "密码至少4位")
    users = load_global_data("users.json")
    if req.username in users: raise HTTPException(400, "用户名已存在")
    users[req.username] = {"passwordHash": _hash_pw(req.password), "created": time.time()}
    save_global_data("users.json", users)
    return {"ok": True}

@app.post("/api/login")
def login(req: AuthReq):
    users = load_global_data("users.json")
    if req.username not in users: raise HTTPException(400, "用户不存在")
    if users[req.username]["passwordHash"] != _hash_pw(req.password): raise HTTPException(400, "密码错误")
    return {"ok": True, "username": req.username}

@app.get("/api/practice/{cat}")
def get_practice(cat: str, username: str = Header(alias="X-Username")):
    d = load_data(f"{username}_practice.json", username)
    return d.get(cat, {})

@app.put("/api/practice/{cat}")
def save_practice(cat: str, username: str = Header(alias="X-Username"), data: dict = None):
    d = load_data(f"{username}_practice.json", username)
    d[cat] = data
    save_data(f"{username}_practice.json", d, username)
    return {"ok": True}

@app.get("/api/exam")
def get_exam(username: str = Header(alias="X-Username")):
    return load_data(f"{username}_exam.json", username)

@app.put("/api/exam")
def save_exam(username: str = Header(alias="X-Username"), data: dict = None):
    save_data(f"{username}_exam.json", data, username)
    return {"ok": True}

@app.delete("/api/exam")
def clear_exam(username: str = Header(alias="X-Username")):
    save_data(f"{username}_exam.json", {}, username)
    return {"ok": True}

@app.get("/api/wrongbook")
def get_wrongbook(username: str = Header(alias="X-Username")):
    return load_data(f"{username}_wrongbook.json", username)

@app.put("/api/wrongbook")
def save_wrongbook(username: str = Header(alias="X-Username"), data: dict = None):
    save_data(f"{username}_wrongbook.json", data, username)
    return {"ok": True}

@app.delete("/api/wrongbook")
def clear_wrongbook(username: str = Header(alias="X-Username")):
    save_data(f"{username}_wrongbook.json", {}, username)
    return {"ok": True}

@app.get("/api/user-stats")
def get_user_stats(username: str = Header(alias="X-Username")):
    wb = load_data(f"{username}_wrongbook.json", username)
    wrongCount = len(wb)
    totalWrongs = sum(v.get("wrongCount", 0) for v in wb.values())
    user_st = load_data(f"{username}_stats.json", username)
    totalAnswered = user_st.get("totalAnswered", 0)
    if totalAnswered == 0:
        practice = load_data(f"{username}_practice.json", username)
        totalAnswered = sum(len(v.get("answered", {})) for v in practice.values())
    return {"wrongKindCount": wrongCount, "totalWrongs": totalWrongs, "totalAnswered": totalAnswered}

@app.get("/api/global-stats")
def get_global_stats():
    return load_global_data("global_stats.json")

@app.post("/api/record-answer")
def record_answer(data: dict):
    gs = load_global_data("global_stats.json")
    qid = str(data.get("questionId", ""))
    correct = data.get("correct", False)
    if qid not in gs: gs[qid] = {"totalAttempts": 0, "correctAttempts": 0}
    gs[qid]["totalAttempts"] += 1
    if correct: gs[qid]["correctAttempts"] += 1
    save_global_data("global_stats.json", gs)
    username = data.get("username", "")
    if username:
        user_st = load_data(f"{username}_stats.json", username)
        user_st["totalAnswered"] = user_st.get("totalAnswered", 0) + 1
        save_data(f"{username}_stats.json", user_st, username)
    return {"ok": True}

@app.post("/api/record-wrong")
def record_wrong(username: str = Header(alias="X-Username"), data: dict = None):
    wb = load_data(f"{username}_wrongbook.json", username)
    qid = str(data.get("questionId", ""))
    wrong_answer = data.get("wrongAnswer", "")
    if qid not in wb: wb[qid] = {"wrongCount": 0, "lastWrongAnswer": "", "questionId": int(qid)}
    wb[qid]["wrongCount"] += 1
    wb[qid]["lastWrongAnswer"] = wrong_answer
    save_data(f"{username}_wrongbook.json", wb, username)
    return {"ok": True}

@app.post("/api/remove-wrong")
def remove_wrong(username: str = Header(alias="X-Username"), data: dict = None):
    wb = load_data(f"{username}_wrongbook.json", username)
    qid = str(data.get("questionId", ""))
    if qid in wb: del wb[qid]
    save_data(f"{username}_wrongbook.json", wb, username)
    return {"ok": True}

@app.delete("/api/user-data/{username}")
def reset_user_data(username: str):
    save_data(f"{username}_practice.json", {}, username)
    save_data(f"{username}_exam.json", {}, username)
    save_data(f"{username}_wrongbook.json", {}, username)
    return {"ok": True}

# ========== 数据导出/导入 ==========
@app.get("/api/export-data")
def export_data(username: str = Header(alias="X-Username")):
    files = {}
    for suffix in ["_practice.json", "_exam.json", "_wrongbook.json", "_stats.json"]:
        fname = f"{username}{suffix}"
        d = load_data(fname, username)
        if d:
            files[fname] = d
    export_payload = {
        "username": username,
        "exportTime": time.time(),
        "data": files,
        "cloudDbEnabled": USE_CLOUD_DB
    }
    json_str = json.dumps(export_payload, ensure_ascii=False, indent=2)
    return Response(
        content=json_str,
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={username}_backup.json"}
    )

@app.post("/api/import-data")
def import_data(username: str = Header(alias="X-Username"), data: dict = None):
    if not data or "data" not in data:
        raise HTTPException(400, "Invalid backup file format")
    for fname, d in data["data"].items():
        save_data(fname, d, username)
    return {"ok": True, "message": "数据导入成功"}

# ========== Supabase 表初始化接口 ==========
@app.post("/api/init-cloud-db")
def init_cloud_db():
    """返回需要在 Supabase 中执行的 SQL"""
    sql = """
-- 在 Supabase SQL Editor 中执行以下语句：

-- 1. 创建用户数据表
CREATE TABLE IF NOT EXISTS user_data (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  data_key TEXT NOT NULL,
  data_value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(username, data_key)
);

-- 2. 创建全局数据表（统计信息等）
CREATE TABLE IF NOT EXISTS global_data (
  id SERIAL PRIMARY KEY,
  data_key TEXT NOT NULL UNIQUE,
  data_value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. 开启行级安全（可选，公开访问时不需要）
-- ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE global_data ENABLE ROW LEVEL SECURITY;

-- 4. 创建策略：允许匿名访问（因为我们用 anon key）
-- 在 Supabase Dashboard -> Authentication -> Policies 中设置：
-- user_data: Enable SELECT, INSERT, UPDATE, DELETE for anonymous users
-- global_data: Enable SELECT, INSERT, UPDATE, DELETE for anonymous users

-- 或者直接执行（推荐）：
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous access" ON user_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access" ON global_data FOR ALL USING (true) WITH CHECK (true);
"""
    return {"sql": sql}

# ========== 静态文件 ==========
@app.get("/")
def serve_index():
    return FileResponse(STATIC_DIR / "index.html", media_type="text/html")

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
