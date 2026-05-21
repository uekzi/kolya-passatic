import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { seedFavorites, seedMovies, seedRatings, seedUsers } from "../data/seed.js";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function rowToUser(row) {
  if (!row) return null;
  const preferences = row.preferences ?? {};
  if (preferences.configured === undefined) {
    preferences.configured = row.email === "demo@kinomood.local";
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    preferences,
    createdAt: row.created_at
  };
}

function rowToMovie(row) {
  if (!row) return null;
  return {
    id: row.id,
    tmdbId: row.tmdb_id,
    type: row.type,
    title: row.title,
    originalTitle: row.original_title,
    year: row.year,
    genres: row.genres ?? [],
    director: row.director,
    actors: row.actors ?? [],
    description: row.description,
    posterUrl: row.poster_url,
    backdropUrl: row.backdrop_url,
    popularity: Number(row.popularity ?? 0),
    voteAverage: Number(row.vote_average ?? 0),
    tags: row.tags ?? [],
    moods: row.moods ?? [],
    aspects: row.aspects ?? {},
    trailerUrl: row.trailer_url
  };
}

export async function createPostgresStore({ connectionString, hashPassword }) {
  const pool = new Pool({ connectionString });
  const schema = await fs.readFile(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  const store = new PostgresStore(pool);
  await store.seed(hashPassword);
  return store;
}

class PostgresStore {
  constructor(pool) {
    this.pool = pool;
  }

  sanitizeUser(user) {
    if (!user) return null;
    const { passwordHash, ...safe } = user;
    return safe;
  }

  async seed(hashPassword) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const movie of seedMovies) {
        await client.query(
          `INSERT INTO movies
            (id, tmdb_id, type, title, original_title, year, genres, director, actors, description,
             poster_url, backdrop_url, popularity, vote_average, tags, moods, aspects, trailer_url)
           VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
           ON CONFLICT (id) DO NOTHING`,
          [
            movie.id,
            movie.tmdbId,
            movie.type,
            movie.title,
            movie.originalTitle,
            movie.year,
            movie.genres,
            movie.director,
            movie.actors,
            movie.description,
            movie.posterUrl,
            movie.backdropUrl,
            movie.popularity,
            movie.voteAverage,
            movie.tags,
            movie.moods,
            movie.aspects,
            movie.trailerUrl
          ]
        );
      }

      for (const user of seedUsers) {
        const passwordHash = await hashPassword(user.password);
        await client.query(
          `INSERT INTO users (id, email, display_name, password_hash, preferences, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (email) DO NOTHING`,
          [user.id, user.email, user.displayName, passwordHash, user.preferences, user.createdAt]
        );
      }

      for (const rating of seedRatings) {
        await client.query(
          `INSERT INTO ratings (user_id, movie_id, rating, rated_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, movie_id) DO NOTHING`,
          [rating.userId, rating.movieId, rating.rating, rating.ratedAt]
        );
      }

      for (const favorite of seedFavorites) {
        await client.query(
          `INSERT INTO favorites (user_id, movie_id, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, movie_id) DO NOTHING`,
          [favorite.userId, favorite.movieId, favorite.createdAt]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getUserByEmail(email) {
    const result = await this.pool.query("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
    return rowToUser(result.rows[0]);
  }

  async getUserById(id) {
    const result = await this.pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return rowToUser(result.rows[0]);
  }

  async createUser({ email, passwordHash, displayName, preferences }) {
    const result = await this.pool.query(
      `INSERT INTO users (email, display_name, password_hash, preferences)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [email, displayName || email.split("@")[0], passwordHash, preferences]
    );
    return rowToUser(result.rows[0]);
  }

  async updateUserPreferences(userId, preferences) {
    const result = await this.pool.query(
      "UPDATE users SET preferences = $2 WHERE id = $1 RETURNING *",
      [userId, preferences]
    );
    return rowToUser(result.rows[0]);
  }

  async listMovies({ query = "", type = "", genre = "", tag = "", mood = "" } = {}) {
    const clauses = [];
    const values = [];
    if (query) {
      values.push(`%${query}%`);
      clauses.push(`(title ILIKE $${values.length} OR original_title ILIKE $${values.length} OR director ILIKE $${values.length})`);
    }
    if (type) {
      values.push(type);
      clauses.push(`type = $${values.length}`);
    }
    if (genre) {
      values.push(genre);
      clauses.push(`$${values.length} = ANY(genres)`);
    }
    if (tag) {
      values.push(tag);
      clauses.push(`$${values.length} = ANY(tags)`);
    }
    if (mood) {
      values.push(mood);
      clauses.push(`$${values.length} = ANY(moods)`);
    }
    const sql = `SELECT DISTINCT ON (id) * FROM movies ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY id, popularity DESC`;
    const result = await this.pool.query(sql, values);
    return result.rows.map(rowToMovie);
  }

  async getMovieById(id) {
    const result = await this.pool.query("SELECT * FROM movies WHERE id = $1", [id]);
    return rowToMovie(result.rows[0]);
  }

  async getRatingsByUser(userId) {
    const result = await this.pool.query("SELECT user_id, movie_id, rating, rated_at FROM ratings WHERE user_id = $1", [userId]);
    return result.rows.map((row) => ({
      userId: row.user_id,
      movieId: row.movie_id,
      rating: row.rating,
      ratedAt: row.rated_at
    }));
  }

  async getAllRatings() {
    const result = await this.pool.query("SELECT user_id, movie_id, rating, rated_at FROM ratings");
    return result.rows.map((row) => ({
      userId: row.user_id,
      movieId: row.movie_id,
      rating: row.rating,
      ratedAt: row.rated_at
    }));
  }

  async upsertRating(userId, movieId, rating) {
    const result = await this.pool.query(
      `INSERT INTO ratings (user_id, movie_id, rating)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, movie_id)
       DO UPDATE SET rating = excluded.rating, rated_at = now()
       RETURNING user_id, movie_id, rating, rated_at`,
      [userId, movieId, rating]
    );
    await this.pool.query(
      "INSERT INTO user_movie_events (user_id, movie_id, event_type, event_value) VALUES ($1, $2, 'rating', $3)",
      [userId, movieId, { rating }]
    );
    const row = result.rows[0];
    return { userId: row.user_id, movieId: row.movie_id, rating: row.rating, ratedAt: row.rated_at };
  }

  async getFavoritesByUser(userId) {
    const result = await this.pool.query("SELECT user_id, movie_id, created_at FROM favorites WHERE user_id = $1", [userId]);
    return result.rows.map((row) => ({ userId: row.user_id, movieId: row.movie_id, createdAt: row.created_at }));
  }

  async toggleFavorite(userId, movieId) {
    const existing = await this.pool.query("SELECT 1 FROM favorites WHERE user_id = $1 AND movie_id = $2", [userId, movieId]);
    if (existing.rowCount) {
      await this.pool.query("DELETE FROM favorites WHERE user_id = $1 AND movie_id = $2", [userId, movieId]);
      await this.pool.query(
        "INSERT INTO user_movie_events (user_id, movie_id, event_type, event_value) VALUES ($1, $2, 'favorite', $3)",
        [userId, movieId, { favorite: false }]
      );
      return false;
    }
    await this.pool.query("INSERT INTO favorites (user_id, movie_id) VALUES ($1, $2)", [userId, movieId]);
    await this.pool.query(
      "INSERT INTO user_movie_events (user_id, movie_id, event_type, event_value) VALUES ($1, $2, 'favorite', $3)",
      [userId, movieId, { favorite: true }]
    );
    return true;
  }

  async addMovies(movies) {
    let added = 0;
    for (const movie of movies) {
      const result = await this.pool.query(
        `INSERT INTO movies
          (id, tmdb_id, type, title, original_title, year, genres, director, actors, description,
           poster_url, backdrop_url, popularity, vote_average, tags, moods, aspects, trailer_url)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (id) DO NOTHING`,
        [
          movie.id,
          movie.tmdbId,
          movie.type,
          movie.title,
          movie.originalTitle,
          movie.year,
          movie.genres,
          movie.director,
          movie.actors,
          movie.description,
          movie.posterUrl,
          movie.backdropUrl,
          movie.popularity,
          movie.voteAverage,
          movie.tags,
          movie.moods,
          movie.aspects,
          movie.trailerUrl
        ]
      );
      added += result.rowCount;
    }
    return added;
  }
}
