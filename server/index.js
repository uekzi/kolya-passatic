import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createFileStore } from "./data/fileStore.js";
import { createPostgresStore } from "./db/postgresStore.js";
import { buildProfileStats, buildRecommendationPool, buildSections, getDefaultPreferences } from "./services/recommendations.js";
import { discoverTmdb, hasTmdbCredentials, mapTmdbResult, searchTmdb } from "./services/tmdb.js";

const PORT = Number(process.env.PORT ?? 4200);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://127.0.0.1:5173";
const TOKEN_TTL_SECONDS = 24 * 60 * 60;
const TOKEN_ROTATE_AFTER_SECONDS = 23 * 60 * 60;

function normalizePreferences(input = {}) {
  const defaults = getDefaultPreferences();
  return {
    genres: Array.isArray(input.genres) ? input.genres.slice(0, 10) : defaults.genres,
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 12) : defaults.tags,
    moods: Array.isArray(input.moods) ? input.moods.slice(0, 8) : defaults.moods,
    directors: Array.isArray(input.directors) ? input.directors.slice(0, 8) : defaults.directors,
    aspects: {
      plot: clampAspect(input.aspects?.plot ?? defaults.aspects.plot),
      visual: clampAspect(input.aspects?.visual ?? defaults.aspects.visual),
      atmosphere: clampAspect(input.aspects?.atmosphere ?? defaults.aspects.atmosphere),
      dialogues: clampAspect(input.aspects?.dialogues ?? defaults.aspects.dialogues)
    },
    configured: Boolean(input.configured)
  };
}

function clampAspect(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return 5;
  return Math.max(1, Math.min(10, numeric));
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function signUser(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

function publicUser(store, user) {
  return store.sanitizeUser(user);
}

async function createStore() {
  if (process.env.DATABASE_URL) {
    return createPostgresStore({ connectionString: process.env.DATABASE_URL, hashPassword });
  }
  return createFileStore({ hashPassword });
}

const store = await createStore();
const app = express();

app.use(
  cors({
    origin: CLIENT_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
    exposedHeaders: ["x-rotated-token"]
  })
);
app.use(express.json({ limit: "1mb" }));

async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next();

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.user = await store.getUserById(payload.sub);
    req.tokenPayload = payload;
  } catch {
    req.user = null;
  }

  next();
}

function rotateTokenIfNeeded(req, res) {
  if (!req.user || !req.tokenPayload?.iat) return;
  const tokenAgeSeconds = Math.floor(Date.now() / 1000) - req.tokenPayload.iat;
  if (tokenAgeSeconds >= TOKEN_ROTATE_AFTER_SECONDS) {
    res.set("x-rotated-token", signUser(req.user));
  }
}

async function requireAuth(req, res, next) {
  await optionalAuth(req, res, () => {});
  if (!req.user) {
    return res.status(401).json({ message: "Нужна авторизация." });
  }
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    storage: process.env.DATABASE_URL ? "postgresql" : "local-demo",
    tmdb: hasTmdbCredentials(),
    jwtRotationHours: 24
  });
});

app.post("/api/auth/register", async (req, res) => {
  const { email, password, displayName, preferences } = req.body;
  if (!email || !String(email).includes("@")) {
    return res.status(400).json({ message: "Укажите корректный email." });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ message: "Пароль должен быть не короче 6 символов." });
  }

  const existing = await store.getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ message: "Пользователь с таким email уже существует." });
  }

  const user = await store.createUser({
    email,
    displayName,
    passwordHash: await hashPassword(password),
    preferences: normalizePreferences(preferences)
  });

  res.status(201).json({ token: signUser(user), user: publicUser(store, user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await store.getUserByEmail(email ?? "");
  if (!user || !(await bcrypt.compare(password ?? "", user.passwordHash))) {
    return res.status(401).json({ message: "Неверный email или пароль." });
  }

  res.json({ token: signUser(user), user: publicUser(store, user) });
});

app.post("/api/auth/demo", async (_req, res) => {
  const user = await store.getUserByEmail("demo@kinomood.local");
  res.json({ token: signUser(user), user: publicUser(store, user) });
});

app.post("/api/auth/refresh", requireAuth, async (req, res) => {
  res.json({ token: signUser(req.user), user: publicUser(store, req.user), rotationHours: 24 });
});

app.get("/api/me", requireAuth, async (req, res) => {
  const movies = await store.listMovies();
  const ratings = await store.getRatingsByUser(req.user.id);
  const favorites = await store.getFavoritesByUser(req.user.id);
  rotateTokenIfNeeded(req, res);
  res.json({
    user: publicUser(store, req.user),
    stats: buildProfileStats({ movies, ratings, favorites })
  });
});

app.put("/api/me/preferences", requireAuth, async (req, res) => {
  const preferences = normalizePreferences({ ...req.body.preferences, configured: true });
  const user = await store.updateUserPreferences(req.user.id, preferences);
  rotateTokenIfNeeded(req, res);
  res.json({ user: publicUser(store, user) });
});

app.get("/api/sections", optionalAuth, async (req, res) => {
  const movies = await store.listMovies();
  const userRatings = req.user ? await store.getRatingsByUser(req.user.id) : [];
  const favorites = req.user ? await store.getFavoritesByUser(req.user.id) : [];
  const sections = buildSections({ movies, user: req.user, userRatings, favorites, mood: req.query.mood ?? "" });
  rotateTokenIfNeeded(req, res);
  res.json({ user: publicUser(store, req.user), sections });
});

app.get("/api/recommendations/pool", optionalAuth, async (req, res) => {
  const movies = await store.listMovies();
  const userRatings = req.user ? await store.getRatingsByUser(req.user.id) : [];
  const favorites = req.user ? await store.getFavoritesByUser(req.user.id) : [];
  const pool = buildRecommendationPool({ movies, user: req.user, userRatings, favorites, mood: req.query.mood ?? "" });
  rotateTokenIfNeeded(req, res);
  res.json({ items: pool });
});

app.get("/api/movies", optionalAuth, async (req, res) => {
  const movies = await store.listMovies({
    query: req.query.query ?? "",
    type: req.query.type ?? "",
    genre: req.query.genre ?? "",
    tag: req.query.tag ?? "",
    mood: req.query.mood ?? ""
  });
  const ratings = req.user ? await store.getRatingsByUser(req.user.id) : [];
  const favorites = req.user ? await store.getFavoritesByUser(req.user.id) : [];
  const favoriteIds = new Set(favorites.map((favorite) => favorite.movieId));
  rotateTokenIfNeeded(req, res);
  const enriched = movies.map((movie) => ({
    ...movie,
    isFavorite: favoriteIds.has(movie.id),
    userRating: ratings.find((rating) => rating.movieId === movie.id)?.rating ?? null
  }));
  res.json({ items: enriched });
});

app.get("/api/movies/:id", optionalAuth, async (req, res) => {
  const movie = await store.getMovieById(req.params.id);
  if (!movie) return res.status(404).json({ message: "Фильм не найден." });
  const ratings = req.user ? await store.getRatingsByUser(req.user.id) : [];
  const favorites = req.user ? await store.getFavoritesByUser(req.user.id) : [];
  rotateTokenIfNeeded(req, res);
  res.json({
    item: {
      ...movie,
      isFavorite: favorites.some((favorite) => favorite.movieId === movie.id),
      userRating: ratings.find((rating) => rating.movieId === movie.id)?.rating ?? null
    }
  });
});

app.post("/api/movies/:id/rate", requireAuth, async (req, res) => {
  const movie = await store.getMovieById(req.params.id);
  if (!movie) return res.status(404).json({ message: "Фильм не найден." });
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
    return res.status(400).json({ message: "Оценка должна быть числом от 1 до 10." });
  }

  const saved = await store.upsertRating(req.user.id, movie.id, rating);
  rotateTokenIfNeeded(req, res);
  res.json({ rating: saved });
});

app.post("/api/movies/:id/favorite", requireAuth, async (req, res) => {
  const movie = await store.getMovieById(req.params.id);
  if (!movie) return res.status(404).json({ message: "Фильм не найден." });
  const favorite = await store.toggleFavorite(req.user.id, movie.id);
  rotateTokenIfNeeded(req, res);
  res.json({ favorite });
});

app.get("/api/tmdb/search", async (req, res) => {
  if (!hasTmdbCredentials()) {
    return res.status(400).json({ message: "TMDB credentials are not configured." });
  }
  const query = String(req.query.query ?? "").trim();
  if (!query) return res.status(400).json({ message: "Query is required." });
  const result = await searchTmdb(query);
  res.json(result);
});

app.post("/api/admin/tmdb/discover", async (req, res) => {
  if (!hasTmdbCredentials()) {
    return res.status(400).json({ message: "TMDB credentials are not configured." });
  }
  const { type = "movie", page = 1 } = req.body ?? {};
  const result = await discoverTmdb({ type, page });
  const movies = result.results.slice(0, 20).map((item) => mapTmdbResult(item, type));
  const added = await store.addMovies(movies);
  res.json({ added, total: result.total_results });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Внутренняя ошибка сервера." });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`API ready on http://127.0.0.1:${PORT}`);
});
