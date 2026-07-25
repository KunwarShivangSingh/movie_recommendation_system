/**
 * Movie Recommendation System — main.js
 * Handles: API calls, rendering, search, filters, dark mode, ratings
 */

"use strict";

// ── Config ────────────────────────────────────────────────
const API = {
  movies:      "/api/movies",
  search:      "/api/movies/search",
  genre:       (g)   => `/api/movies/genre/${encodeURIComponent(g)}`,
  movie:       (id)  => `/api/movies/${id}`,
  recommend:   (id)  => `/api/recommend/${id}`,
  ratings:     "/api/ratings",
  genres:      "/api/genres",
  stats:       "/api/stats",
};

// Genre → colour mapping (mirrors genres.json)
const GENRE_COLORS = {
  "Action":    "#e74c3c", "Adventure": "#e67e22", "Animation": "#f39c12",
  "Comedy":    "#2ecc71", "Crime":     "#8e44ad", "Drama":     "#3498db",
  "History":   "#795548", "Horror":    "#1a1a1a", "Music":     "#9b59b6",
  "Mystery":   "#2c3e50", "Romance":   "#e91e63", "Sci-Fi":    "#00bcd4",
  "Thriller":  "#f44336", "War":       "#607d8b",
};

// ── Utility ───────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function debounce(fn, delay = 320) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

// ── Dark Mode ─────────────────────────────────────────────
function initDarkMode() {
  const saved = localStorage.getItem("theme") || "light";
  applyTheme(saved);

  $$(".dark-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem("theme", next);
    });
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $$(".dark-toggle").forEach(btn => {
    btn.textContent = theme === "dark" ? "☀️ Light" : "🌙 Dark";
  });
}

// ── Toast Notifications ───────────────────────────────────
function toast(msg, type = "success") {
  let container = $("#toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.className = `toast-msg ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Movie Card Builder ────────────────────────────────────
function buildPosterStyle(movie) {
  const color = movie.poster_color || "1a1a2e";
  return `background: #${color};`;
}

function genreTagsHTML(genres, limit = 2) {
  return genres.slice(0, limit).map(g => {
    const color = GENRE_COLORS[g] || "#666";
    return `<span class="genre-tag" style="background:${color}">${g}</span>`;
  }).join("");
}

function starHTML(rating) {
  const full = Math.round(rating / 2);       // 10-scale → 5 stars
  return "★".repeat(full) + "☆".repeat(5 - full);
}

function movieCardHTML(movie, showSimilarity = false) {
  const genres = movie.genre || [];
  const simPct = showSimilarity ? Math.round((movie.similarity || 0) * 100) : 0;

  return `
    <div class="movie-card" onclick="goToMovie(${movie.id})">
      <div class="movie-poster">
        <div class="poster-placeholder" style="${buildPosterStyle(movie)}">
          <div class="movie-icon">🎬</div>
          <div class="poster-title">${movie.title}</div>
          <div class="poster-year">${movie.year}</div>
        </div>
        <div class="rating-badge">⭐ ${movie.rating}</div>
        <div class="card-overlay">
          <div class="overlay-actions">
            <button class="btn-overlay" onclick="event.stopPropagation();goToMovie(${movie.id})">Details</button>
            <button class="btn-overlay" onclick="event.stopPropagation();goToRecommend(${movie.id})">Similar</button>
          </div>
        </div>
      </div>
      <div class="card-body-custom">
        <div class="card-title">${movie.title}</div>
        <div class="card-meta">
          <span>${movie.year}</span>
          <span>·</span>
          <span>${movie.duration || "—"} min</span>
        </div>
        <div class="card-genres">${genreTagsHTML(genres)}</div>
        ${showSimilarity ? `
        <div class="similarity-bar-wrap">
          <div class="similarity-label"><span>Match</span><span>${simPct}%</span></div>
          <div class="similarity-bar">
            <div class="similarity-fill" style="width:${simPct}%"></div>
          </div>
        </div>` : ""}
      </div>
    </div>`;
}

function renderGrid(containerId, movies, showSimilarity = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!movies || movies.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <span class="empty-icon">🎬</span>
        <h4>No movies found</h4>
        <p>Try a different search term or filter.</p>
      </div>`;
    return;
  }

  container.innerHTML = movies.map(m => movieCardHTML(m, showSimilarity)).join("");
}

function setLoading(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<div class="loading-wrap" style="grid-column:1/-1"><div class="spinner"></div></div>`;
}

// ── Navigation ────────────────────────────────────────────
function goToMovie(id)      { window.location.href = `/movie/${id}`; }
function goToRecommend(id)  { window.location.href = `/recommend/${id}`; }

// ═══════════════════════════════════════════════════════════
//  INDEX PAGE
// ═══════════════════════════════════════════════════════════
async function initIndexPage() {
  await loadStats();
  await loadGenrePills();
  await loadMovies();
  initSearch();
  initSortFilter();
}

// Stats bar
async function loadStats() {
  try {
    const data = await apiFetch(API.stats);
    if (!data.success) return;
    const el = id => document.getElementById(id);
    if (el("statMovies"))  el("statMovies").textContent  = data.total_movies;
    if (el("statGenres"))  el("statGenres").textContent  = data.total_genres;
    if (el("statRatings")) el("statRatings").textContent = data.total_ratings;
    if (el("statAvg"))     el("statAvg").textContent     = data.avg_rating;
  } catch (e) { /* silent */ }
}

// Genre pills
async function loadGenrePills() {
  const container = document.getElementById("genrePills");
  if (!container) return;
  try {
    const data = await apiFetch(API.genres);
    const allPill = `<span class="genre-pill active" data-genre="" style="border-color:#e63946;color:#e63946" onclick="filterByGenre(this,'')">All</span>`;
    const pills = data.genres.map(g => {
      const color = `#${g.color}`;
      return `<span class="genre-pill" data-genre="${g.name}" style="border-color:${color}" onclick="filterByGenre(this,'${g.name}')">${g.icon} ${g.name}</span>`;
    }).join("");
    container.innerHTML = allPill + pills;
  } catch (e) { container.innerHTML = ""; }
}

window.filterByGenre = async function(el, genre) {
  $$(".genre-pill").forEach(p => {
    p.classList.remove("active");
    p.style.background = "";
    p.style.color = "";
  });
  const color = el.style.borderColor || "#e63946";
  el.classList.add("active");
  el.style.background = color;
  el.style.color = "#fff";

  setLoading("moviesGrid");
  updateResultCount(null);

  try {
    let data;
    if (genre) {
      data = await apiFetch(API.genre(genre));
      renderGrid("moviesGrid", data.movies);
      updateResultCount(data.count);
    } else {
      await loadMovies();
    }
  } catch (e) {
    toast("Failed to load genre", "error");
  }
};

// Load all movies
let allMovies = [];
async function loadMovies(sortBy = "rating", order = "desc") {
  setLoading("moviesGrid");
  try {
    const data = await apiFetch(`${API.movies}?sort=${sortBy}&order=${order}`);
    allMovies = data.movies;
    renderGrid("moviesGrid", allMovies);
    updateResultCount(allMovies.length);
  } catch (e) {
    toast("Failed to load movies", "error");
  }
}

function updateResultCount(n) {
  const el = document.getElementById("resultCount");
  if (el) el.textContent = n !== null ? `${n} movie${n !== 1 ? "s" : ""}` : "";
}

// Search
function initSearch() {
  // Hero search form
  const heroForm = document.getElementById("heroSearchForm");
  if (heroForm) {
    heroForm.addEventListener("submit", e => {
      e.preventDefault();
      performSearch();
    });
  }

  const heroInput = document.getElementById("heroSearch");
  if (heroInput) {
    heroInput.addEventListener("input", debounce(performSearch, 400));
  }

  // Navbar search
  const navForm = document.getElementById("navSearchForm");
  if (navForm) {
    navForm.addEventListener("submit", e => {
      e.preventDefault();
      const q = $("#navSearch").value.trim();
      if (q) {
        window.location.href = `/?q=${encodeURIComponent(q)}`;
      }
    });
  }

  // Pre-fill from URL param
  const urlQ = new URLSearchParams(window.location.search).get("q");
  if (urlQ && heroInput) {
    heroInput.value = urlQ;
    performSearch();
  }
}

async function performSearch() {
  const q       = (document.getElementById("heroSearch")?.value   || "").trim();
  const genre   = (document.getElementById("genreFilter")?.value  || "").trim();
  const minYear = (document.getElementById("yearFrom")?.value     || "");
  const minRate = (document.getElementById("ratingFilter")?.value || "");

  if (!q && !genre && !minYear && !minRate) {
    renderGrid("moviesGrid", allMovies);
    updateResultCount(allMovies.length);
    return;
  }

  setLoading("moviesGrid");
  let url = `${API.search}?q=${encodeURIComponent(q)}`;
  if (genre)   url += `&genre=${encodeURIComponent(genre)}`;
  if (minYear) url += `&min_year=${minYear}`;
  if (minRate) url += `&min_rating=${minRate}`;

  try {
    const data = await apiFetch(url);
    renderGrid("moviesGrid", data.movies);
    updateResultCount(data.count);
  } catch (e) {
    toast("Search failed", "error");
  }
}

function initSortFilter() {
  const sortSel = document.getElementById("sortSelect");
  if (sortSel) {
    sortSel.addEventListener("change", () => {
      const [field, order] = sortSel.value.split("-");
      loadMovies(field, order);
    });
  }

  const filterSelects = ["genreFilter", "yearFrom", "ratingFilter"];
  filterSelects.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", performSearch);
  });
}

// ═══════════════════════════════════════════════════════════
//  MOVIE DETAIL PAGE
// ═══════════════════════════════════════════════════════════
async function initDetailPage(movieId) {
  await loadMovieDetail(movieId);
  await loadDetailRecommendations(movieId);
  initStarRating(movieId);
}

async function loadMovieDetail(movieId) {
  try {
    const data = await apiFetch(API.movie(movieId));
    if (!data.success) return;
    const m = data.movie;

    // Poster
    const posterEl = document.getElementById("detailPoster");
    if (posterEl) {
      posterEl.style.cssText = buildPosterStyle(m);
      const iconEl = posterEl.querySelector(".movie-icon");
      const titleEl = posterEl.querySelector(".poster-title");
      const yearEl  = posterEl.querySelector(".poster-year");
      if (iconEl)  iconEl.textContent  = "🎬";
      if (titleEl) titleEl.textContent = m.title;
      if (yearEl)  yearEl.textContent  = m.year;
    }

    // Text fields
    setText("detailTitle",    m.title);
    setText("detailYear",     m.year);
    setText("detailDuration", `${m.duration || "?"} min`);
    setText("detailDirector", m.director);
    setText("detailLanguage", m.language || "English");
    setText("detailDesc",     m.description);
    setText("detailRatingNum",`${m.rating}/10`);

    // Genres
    const genresEl = document.getElementById("detailGenres");
    if (genresEl) {
      genresEl.innerHTML = m.genre.map(g => {
        const c = GENRE_COLORS[g] || "#666";
        return `<span class="genre-badge" style="background:${c}">${g}</span>`;
      }).join("");
    }

    // Cast
    const castEl = document.getElementById("detailCast");
    if (castEl) {
      castEl.innerHTML = m.cast.map(c => `<span class="cast-item">👤 ${c}</span>`).join("");
    }

    // Tags
    const tagsEl = document.getElementById("detailTags");
    if (tagsEl) {
      tagsEl.innerHTML = m.tags.map(t => `<span class="tag-chip">#${t}</span>`).join("");
    }

    // User rating
    if (m.user_rating_count > 0) {
      setText("userRatingDisplay", `Community: ${m.user_rating}/10 (${m.user_rating_count} votes)`);
    }

    // Page title
    document.title = `${m.title} — MovieRec`;

  } catch (e) {
    toast("Failed to load movie", "error");
  }
}

async function loadDetailRecommendations(movieId) {
  const container = document.getElementById("detailRecs");
  if (!container) return;
  setLoading("detailRecs");
  try {
    const data = await apiFetch(API.recommend(movieId));
    const top4 = (data.recommendations || []).slice(0, 4);
    container.innerHTML = top4.map(m => movieCardHTML(m, true)).join("");
    if (top4.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted)">No recommendations found.</p>';
    }
  } catch (e) { container.innerHTML = ""; }
}

// ── Star Rating ───────────────────────────────────────────
function initStarRating(movieId) {
  const stars     = $$(".star");
  const rateBtn   = document.getElementById("rateBtn");
  const ratingVal = document.getElementById("ratingValueDisplay");
  let selected    = 0;

  stars.forEach((star, idx) => {
    star.addEventListener("mouseover", () => {
      stars.forEach((s, i) => s.classList.toggle("hovered", i <= idx));
      if (ratingVal) ratingVal.textContent = `${(idx + 1) * 2}/10`;
    });

    star.addEventListener("mouseleave", () => {
      stars.forEach(s => s.classList.remove("hovered"));
      if (ratingVal) ratingVal.textContent = selected ? `${selected * 2}/10 selected` : "";
    });

    star.addEventListener("click", () => {
      selected = idx + 1;
      stars.forEach((s, i) => {
        s.classList.toggle("selected", i <= idx);
      });
      if (ratingVal) ratingVal.textContent = `${selected * 2}/10 — click Rate to submit`;
    });
  });

  if (rateBtn) {
    rateBtn.addEventListener("click", async () => {
      if (!selected) { toast("Please select a star rating first", "error"); return; }
      rateBtn.disabled = true;
      rateBtn.textContent = "Submitting…";
      try {
        const res = await fetch(API.ratings, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ movie_id: movieId, rating: selected * 2 }),
        });
        const data = await res.json();
        if (data.success) {
          toast(`Rating submitted! Avg: ${data.avg_rating}/10 from ${data.total_ratings} votes ⭐`);
          setText("userRatingDisplay", `Community: ${data.avg_rating}/10 (${data.total_ratings} votes)`);
          rateBtn.textContent = "✓ Rated!";
        } else {
          toast(data.error || "Failed to submit", "error");
          rateBtn.disabled = false;
          rateBtn.textContent = "Submit Rating";
        }
      } catch (e) {
        toast("Network error", "error");
        rateBtn.disabled = false;
        rateBtn.textContent = "Submit Rating";
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════
//  RECOMMEND PAGE
// ═══════════════════════════════════════════════════════════
async function initRecommendPage(movieId) {
  await loadRecommendations(movieId);
}

async function loadRecommendations(movieId) {
  const container = document.getElementById("recsGrid");
  if (!container) return;
  setLoading("recsGrid");
  try {
    const data = await apiFetch(API.recommend(movieId));
    const recs = data.recommendations || [];
    const countEl = document.getElementById("recCount");
    if (countEl) countEl.textContent = `${recs.length} matches found`;
    renderGrid("recsGrid", recs, true);
  } catch (e) {
    toast("Failed to load recommendations", "error");
    container.innerHTML = "";
  }
}

// ── Helpers ───────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Entry Point ───────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initDarkMode();
  const page = document.body.dataset.page;
  if (page === "index")   initIndexPage();
  if (page === "detail")  initDetailPage(+document.body.dataset.movieId);
  if (page === "recommend") initRecommendPage(+document.body.dataset.movieId);
});
