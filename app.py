"""
Movie Recommendation System - Flask Backend
Tech Stack: Python 3, Flask, JSON
"""

from flask import (Flask, jsonify, request, render_template,
                   abort, session, redirect, url_for)
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import json, os, re, functools
from datetime import datetime

app = Flask(__name__)
app.secret_key = "movierec_secret_key_2025"   # change in production
CORS(app)

# ── Paths ────────────────────────────────────────────────────
BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
MOVIES_FILE  = os.path.join(BASE_DIR, "data", "movies.json")
GENRES_FILE  = os.path.join(BASE_DIR, "data", "genres.json")
RATINGS_FILE = os.path.join(BASE_DIR, "data", "ratings.json")
USERS_FILE   = os.path.join(BASE_DIR, "data", "users.json")   

# ── JSON Helpers ─────────────────────────────────────────────
def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# ── Auth Decorator ────────────────────────────────────────────
def login_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return decorated

# ── Validation Helpers ────────────────────────────────────────
def is_valid_email(email):
    return re.match(r"^[\w\.\+\-]+@[\w\-]+\.[a-zA-Z]{2,}$", email)

def validate_name(name):
    name = name.strip()
    if len(name) < 2:
        return False, "Name must be at least 2 characters."
    if not re.match(r"^[A-Za-z ]+$", name):
        return False, "Name can only contain letters and spaces."
    return True, ""

def validate_email(email):
    email = email.strip().lower()
    if not is_valid_email(email):
        return False, "Enter a valid email address."
    return True, ""

def validate_password(password):
    if len(password) < 6:
        return False, "Password must be at least 6 characters."
    if not re.search(r"[0-9]", password):
        return False, "Password must contain at least one number."
    if not re.search(r"[A-Za-z]", password):
        return False, "Password must contain at least one letter."
    return True, ""

# ── Recommendation Engine ─────────────────────────────────────
def jaccard(set_a, set_b):
    a, b = set(set_a), set(set_b)
    if not a and not b:
        return 0.0
    return len(a & b) / len(a | b)

def year_proximity(y1, y2, max_gap=50):
    return max(0.0, 1.0 - abs(y1 - y2) / max_gap)

def compute_similarity(movie_a, movie_b):
    genre_score    = jaccard(movie_a["genre"], movie_b["genre"])
    tag_score      = jaccard(movie_a["tags"],  movie_b["tags"])
    year_score     = year_proximity(movie_a["year"], movie_b["year"])
    director_score = 1.0 if movie_a["director"] == movie_b["director"] else 0.0
    return (0.45 * genre_score + 0.35 * tag_score +
            0.10 * year_score  + 0.10 * director_score)

def get_recommendations(movie_id, top_n=8):
    movies = load_json(MOVIES_FILE)
    target = next((m for m in movies if m["id"] == movie_id), None)
    if not target:
        return []
    scored = []
    for m in movies:
        if m["id"] == movie_id:
            continue
        scored.append({**m, "similarity": round(compute_similarity(target, m), 4)})
    scored.sort(key=lambda x: (-x["similarity"], -x["rating"]))
    return scored[:top_n]

def enrich_with_user_ratings(movies):
    try:
        ratings = load_json(RATINGS_FILE)
    except Exception:
        ratings = []
    tally = {}
    for r in ratings:
        tally.setdefault(r["movie_id"], []).append(r["rating"])
    for m in movies:
        vals = tally.get(m["id"], [])
        m["user_rating"]       = round(sum(vals)/len(vals), 1) if vals else None
        m["user_rating_count"] = len(vals)
    return movies

# ════════════════════════════════════════════════════════════════
#  AUTH PAGE ROUTES
# ════════════════════════════════════════════════════════════════

@app.route("/login")
def login_page():
    if "user_id" in session:
        return redirect(url_for("index"))
    return render_template("login.html")

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))

# ── POST /api/auth/register ───────────────────────────────────
@app.route("/api/auth/register", methods=["POST"])
def api_register():
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400

    name     = (data.get("name")     or "").strip()
    email    = (data.get("email")    or "").strip().lower()
    password = (data.get("password") or "").strip()

    # Validate each field
    ok, msg = validate_name(name)
    if not ok:
        return jsonify({"success": False, "field": "name", "error": msg})

    ok, msg = validate_email(email)
    if not ok:
        return jsonify({"success": False, "field": "email", "error": msg})

    ok, msg = validate_password(password)
    if not ok:
        return jsonify({"success": False, "field": "password", "error": msg})

    users = load_json(USERS_FILE)

    # Check duplicate email
    if any(u["email"] == email for u in users):
        return jsonify({"success": False, "field": "email",
                        "error": "This email is already registered. Please log in."})

    # Save new user
    new_user = {
        "id":         len(users) + 1,
        "name":       name,
        "email":      email,
        "password":   generate_password_hash(password),
        "created_at": datetime.utcnow().isoformat()
    }
    users.append(new_user)
    save_json(USERS_FILE, users)

    # Auto-login after register
    session["user_id"]   = new_user["id"]
    session["user_name"] = new_user["name"]
    session["user_email"]= new_user["email"]

    return jsonify({"success": True, "message": f"Welcome, {name}!",
                    "redirect": url_for("index")})

# ── POST /api/auth/login ──────────────────────────────────────
@app.route("/api/auth/login", methods=["POST"])
def api_login():
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400

    email    = (data.get("email")    or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not email or not password:
        return jsonify({"success": False, "field": "email",
                        "error": "Email and password are required."})

    if not is_valid_email(email):
        return jsonify({"success": False, "field": "email",
                        "error": "Enter a valid email address."})

    users = load_json(USERS_FILE)
    user  = next((u for u in users if u["email"] == email), None)

    if not user or not check_password_hash(user["password"], password):
        return jsonify({"success": False, "field": "password",
                        "error": "Incorrect email or password."})

    session["user_id"]    = user["id"]
    session["user_name"]  = user["name"]
    session["user_email"] = user["email"]

    return jsonify({"success": True, "message": f"Welcome back, {user['name']}!",
                    "redirect": url_for("index")})

# ── GET /api/auth/me ──────────────────────────────────────────
@app.route("/api/auth/me")
def api_me():
    if "user_id" not in session:
        return jsonify({"logged_in": False})
    return jsonify({
        "logged_in":  True,
        "user_id":    session["user_id"],
        "user_name":  session["user_name"],
        "user_email": session["user_email"],
    })

# ════════════════════════════════════════════════════════════════
#  PAGE ROUTES
# ════════════════════════════════════════════════════════════════

@app.route("/")
@login_required
def index():
    return render_template("index.html",
                           user_name=session.get("user_name", ""),
                           user_email=session.get("user_email", ""))

@app.route("/movie/<int:movie_id>")
@login_required
def movie_detail(movie_id):
    movies = load_json(MOVIES_FILE)
    movie  = next((m for m in movies if m["id"] == movie_id), None)
    if not movie:
        abort(404)
    return render_template("movie.html", movie=movie,
                           user_name=session.get("user_name", ""))

@app.route("/recommend/<int:movie_id>")
@login_required
def recommend_page(movie_id):
    movies = load_json(MOVIES_FILE)
    movie  = next((m for m in movies if m["id"] == movie_id), None)
    if not movie:
        abort(404)
    return render_template("recommend.html", movie=movie,
                           user_name=session.get("user_name", ""))

# ════════════════════════════════════════════════════════════════
#  API ROUTES
# ════════════════════════════════════════════════════════════════

@app.route("/api/movies", methods=["GET"])
def api_get_movies():
    movies  = enrich_with_user_ratings(load_json(MOVIES_FILE))
    sort_by = request.args.get("sort",  "rating")
    order   = request.args.get("order", "desc")
    if sort_by == "year":
        movies.sort(key=lambda m: m["year"],          reverse=(order == "desc"))
    elif sort_by == "title":
        movies.sort(key=lambda m: m["title"].lower(), reverse=(order == "desc"))
    else:
        movies.sort(key=lambda m: m["rating"],        reverse=(order == "desc"))
    return jsonify({"success": True, "count": len(movies), "movies": movies})

@app.route("/api/movies/<int:movie_id>", methods=["GET"])
def api_get_movie(movie_id):
    movies = enrich_with_user_ratings(load_json(MOVIES_FILE))
    movie  = next((m for m in movies if m["id"] == movie_id), None)
    if not movie:
        return jsonify({"success": False, "error": "Movie not found"}), 404
    return jsonify({"success": True, "movie": movie})

@app.route("/api/movies/search", methods=["GET"])
def api_search_movies():
    query  = request.args.get("q",          "").lower().strip()
    genre  = request.args.get("genre",      "").strip()
    min_yr = request.args.get("min_year",   type=int)
    max_yr = request.args.get("max_year",   type=int)
    min_rt = request.args.get("min_rating", type=float)
    movies = enrich_with_user_ratings(load_json(MOVIES_FILE))
    results = []
    for m in movies:
        if query:
            haystack = (m["title"] + " " + m["director"] + " " +
                        " ".join(m["cast"]) + " " + " ".join(m["tags"])).lower()
            if query not in haystack:
                continue
        if genre and genre.lower() not in [g.lower() for g in m["genre"]]:
            continue
        if min_yr and m["year"] < min_yr:  continue
        if max_yr and m["year"] > max_yr:  continue
        if min_rt and m["rating"] < min_rt: continue
        results.append(m)
    results.sort(key=lambda m: m["rating"], reverse=True)
    return jsonify({"success": True, "count": len(results), "movies": results})

@app.route("/api/movies/genre/<string:genre>", methods=["GET"])
def api_movies_by_genre(genre):
    movies  = enrich_with_user_ratings(load_json(MOVIES_FILE))
    results = [m for m in movies
               if genre.lower() in [g.lower() for g in m["genre"]]]
    results.sort(key=lambda m: m["rating"], reverse=True)
    return jsonify({"success": True, "genre": genre,
                    "count": len(results), "movies": results})

@app.route("/api/recommend/<int:movie_id>", methods=["GET"])
def api_recommend(movie_id):
    top_n = request.args.get("n", 8, type=int)
    recs  = get_recommendations(movie_id, top_n)
    recs  = enrich_with_user_ratings(recs)
    return jsonify({"success": True, "count": len(recs), "recommendations": recs})

@app.route("/api/genres", methods=["GET"])
def api_get_genres():
    return jsonify({"success": True, "genres": load_json(GENRES_FILE)})

@app.route("/api/ratings", methods=["POST"])
def api_submit_rating():
    data     = request.get_json()
    movie_id = data.get("movie_id")
    rating   = data.get("rating")
    username = session.get("user_name", data.get("username", "anonymous"))
    if movie_id is None or rating is None:
        return jsonify({"success": False, "error": "movie_id and rating required"}), 400
    if not isinstance(rating, (int, float)) or not (1 <= rating <= 10):
        return jsonify({"success": False, "error": "Rating must be 1–10"}), 400
    movies = load_json(MOVIES_FILE)
    if not any(m["id"] == movie_id for m in movies):
        return jsonify({"success": False, "error": "Movie not found"}), 404
    ratings  = load_json(RATINGS_FILE)
    existing = next((r for r in ratings
                     if r["movie_id"] == movie_id and r["username"] == username), None)
    if existing:
        existing["rating"]    = rating
        existing["timestamp"] = datetime.utcnow().isoformat()
    else:
        ratings.append({"movie_id": movie_id, "username": username,
                        "rating": rating, "timestamp": datetime.utcnow().isoformat()})
    save_json(RATINGS_FILE, ratings)
    vals = [r["rating"] for r in ratings if r["movie_id"] == movie_id]
    return jsonify({"success": True, "message": "Rating submitted",
                    "avg_rating": round(sum(vals)/len(vals), 1),
                    "total_ratings": len(vals)})

@app.route("/api/stats", methods=["GET"])
def api_stats():
    movies  = load_json(MOVIES_FILE)
    ratings = load_json(RATINGS_FILE)
    genres  = load_json(GENRES_FILE)
    genre_counts = {}
    for m in movies:
        for g in m["genre"]:
            genre_counts[g] = genre_counts.get(g, 0) + 1
    return jsonify({
        "success": True,
        "total_movies":  len(movies),
        "total_ratings": len(ratings),
        "total_genres":  len(genres),
        "genre_counts":  genre_counts,
        "avg_rating":    round(sum(m["rating"] for m in movies)/len(movies), 2) if movies else 0
    })

# ════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("=" * 55)
    print("  🎬  Movie Recommendation System")
    print("  🌐  http://127.0.0.1:5000")
    print("=" * 55)
    app.run(debug=True, port=5000)
