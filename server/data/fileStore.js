import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { seedFavorites, seedMovies, seedRatings, seedUsers } from "./seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "local-db.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function createFileStore({ hashPassword }) {
  if (await fileExists(DB_PATH)) {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const store = new FileStore(JSON.parse(raw));
    let changed = false;
    for (const user of store.data.users) {
      if (user.preferences && user.preferences.configured === undefined) {
        user.preferences.configured = user.email === "demo@kinomood.local";
        changed = true;
      }
    }
    if (changed) await store.save();
    return store;
  }

  const users = [];
  for (const user of seedUsers) {
    users.push({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      passwordHash: await hashPassword(user.password),
      preferences: clone(user.preferences),
      createdAt: user.createdAt
    });
  }

  const store = new FileStore({
    users,
    movies: clone(seedMovies),
    ratings: clone(seedRatings),
    favorites: clone(seedFavorites),
    events: []
  });

  await store.save();
  return store;
}

class FileStore {
  constructor(data) {
    this.data = data;
  }

  async save() {
    await fs.writeFile(DB_PATH, JSON.stringify(this.data, null, 2), "utf8");
  }

  sanitizeUser(user) {
    if (!user) return null;
    const { passwordHash, ...safe } = user;
    return safe;
  }

  async getUserByEmail(email) {
    return this.data.users.find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async getUserById(id) {
    return this.data.users.find((user) => user.id === id) ?? null;
  }

  async createUser({ email, passwordHash, displayName, preferences }) {
    const user = {
      id: randomUUID(),
      email,
      displayName: displayName || email.split("@")[0],
      passwordHash,
      preferences,
      createdAt: new Date().toISOString()
    };
    this.data.users.push(user);
    await this.save();
    return user;
  }

  async updateUserPreferences(userId, preferences) {
    const user = await this.getUserById(userId);
    if (!user) return null;
    user.preferences = preferences;
    await this.save();
    return user;
  }

  async listMovies({ query = "", type = "", genre = "", tag = "", mood = "" } = {}) {
    const normalized = query.trim().toLowerCase();
    const matches = this.data.movies.filter((movie) => {
      const matchesQuery =
        !normalized ||
        movie.title.toLowerCase().includes(normalized) ||
        movie.originalTitle.toLowerCase().includes(normalized) ||
        movie.director.toLowerCase().includes(normalized);
      const matchesType = !type || movie.type === type;
      const matchesGenre = !genre || movie.genres.includes(genre);
      const matchesTag = !tag || movie.tags.includes(tag);
      const matchesMood = !mood || movie.moods.includes(mood);
      return matchesQuery && matchesType && matchesGenre && matchesTag && matchesMood;
    });

    const seen = new Set();
    return matches.filter((movie) => {
      if (seen.has(movie.id)) return false;
      seen.add(movie.id);
      return true;
    });
  }

  async getMovieById(id) {
    return this.data.movies.find((movie) => movie.id === id) ?? null;
  }

  async getRatingsByUser(userId) {
    return this.data.ratings.filter((rating) => rating.userId === userId);
  }

  async getAllRatings() {
    return this.data.ratings;
  }

  async upsertRating(userId, movieId, rating) {
    const existing = this.data.ratings.find((item) => item.userId === userId && item.movieId === movieId);
    if (existing) {
      existing.rating = rating;
      existing.ratedAt = new Date().toISOString();
    } else {
      this.data.ratings.push({
        userId,
        movieId,
        rating,
        ratedAt: new Date().toISOString()
      });
    }
    this.data.events.push({ userId, movieId, type: "rating", value: rating, createdAt: new Date().toISOString() });
    await this.save();
    return this.data.ratings.find((item) => item.userId === userId && item.movieId === movieId);
  }

  async getFavoritesByUser(userId) {
    return this.data.favorites.filter((favorite) => favorite.userId === userId);
  }

  async toggleFavorite(userId, movieId) {
    const index = this.data.favorites.findIndex((item) => item.userId === userId && item.movieId === movieId);
    let favorite = true;
    if (index >= 0) {
      this.data.favorites.splice(index, 1);
      favorite = false;
    } else {
      this.data.favorites.push({ userId, movieId, createdAt: new Date().toISOString() });
    }
    this.data.events.push({ userId, movieId, type: "favorite", value: favorite, createdAt: new Date().toISOString() });
    await this.save();
    return favorite;
  }

  async addMovies(movies) {
    const existingIds = new Set(this.data.movies.map((movie) => movie.id));
    let added = 0;
    for (const movie of movies) {
      if (!existingIds.has(movie.id)) {
        this.data.movies.push(movie);
        added += 1;
      }
    }
    if (added > 0) await this.save();
    return added;
  }
}
