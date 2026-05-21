import fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config";

const DB_PATH = path.resolve("server/data/local-db.json");
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p";

const genreMap = {
  12: "приключения",
  14: "фэнтези",
  16: "анимация",
  18: "драма",
  27: "ужасы",
  28: "боевик",
  35: "комедия",
  36: "исторический",
  37: "вестерн",
  53: "триллер",
  80: "криминал",
  99: "документальный",
  878: "фантастика",
  9648: "детектив",
  10402: "музыка",
  10749: "мелодрама",
  10751: "семейный",
  10752: "военный",
  10759: "приключения",
  10762: "детский",
  10765: "фантастика",
  10768: "военный",
  10770: "драма"
};

function authHeaders() {
  if (process.env.TMDB_BEARER_TOKEN) {
    return { Authorization: `Bearer ${process.env.TMDB_BEARER_TOKEN}` };
  }
  return {};
}

function withApiKey(url) {
  if (!process.env.TMDB_BEARER_TOKEN && process.env.TMDB_API_KEY) {
    url.searchParams.set("api_key", process.env.TMDB_API_KEY);
  }
  return url;
}

async function tmdb(pathname, params = {}) {
  const url = withApiKey(new URL(`${TMDB_BASE_URL}${pathname}`));
  url.searchParams.set("language", "ru-RU");
  url.searchParams.set("include_adult", "false");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      ...authHeaders()
    }
  });

  if (!response.ok) {
    throw new Error(`TMDB ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function inferTags(genres, voteAverage, type) {
  const tags = [];
  if (genres.includes("анимация") || genres.includes("семейный") || genres.includes("детский")) tags.push("family", "comfort");
  if (genres.includes("фантастика") || genres.includes("фэнтези")) tags.push("visual_masterpiece", "mind_bending");
  if (genres.includes("драма") || genres.includes("мелодрама")) tags.push("emotional", "slow_pace");
  if (genres.includes("триллер") || genres.includes("криминал") || genres.includes("детектив")) tags.push("tense", "detective");
  if (genres.includes("комедия")) tags.push("comfort");
  if (genres.includes("мелодрама")) tags.push("romantic_evening", "smart_dialogue");
  if (voteAverage >= 7.6) tags.push("author_style");
  if (type === "series") tags.push("atmospheric");
  return uniq(tags).slice(0, 5);
}

function inferMoods(genres, tags) {
  const moods = [];
  if (tags.includes("family")) moods.push("семейное", "легкое");
  if (tags.includes("romantic_evening")) moods.push("романтичное", "тихое");
  if (tags.includes("tense")) moods.push("напряженное");
  if (tags.includes("visual_masterpiece")) moods.push("атмосферное");
  if (genres.includes("комедия")) moods.push("легкое");
  if (genres.includes("драма")) moods.push("задумчивое");
  return uniq(moods).slice(0, 4);
}

function inferAspects(genres, voteAverage, tags) {
  const base = Math.max(5, Math.min(10, Math.round(voteAverage || 6)));
  return {
    plot: Math.min(10, base + (genres.includes("детектив") || genres.includes("триллер") ? 1 : 0)),
    visual: Math.min(10, base + (tags.includes("visual_masterpiece") ? 2 : 0)),
    atmosphere: Math.min(10, base + (tags.includes("atmospheric") || tags.includes("tense") ? 1 : 0)),
    dialogues: Math.min(10, base + (genres.includes("драма") || genres.includes("мелодрама") ? 1 : 0))
  };
}

function mapResult(item, type) {
  const isSeries = type === "series";
  const genres = uniq((item.genre_ids ?? []).map((id) => genreMap[id])).slice(0, 4);
  const voteAverage = Number((item.vote_average ?? 0).toFixed(1));
  const tags = inferTags(genres, voteAverage, type);
  const moods = inferMoods(genres, tags);
  const year = Number(((isSeries ? item.first_air_date : item.release_date) || "").slice(0, 4)) || 2024;
  const title = isSeries ? item.name : item.title;
  const originalTitle = isSeries ? item.original_name : item.original_title;

  return {
    id: `tmdb_${isSeries ? "s" : "m"}_${item.id}`,
    tmdbId: item.id,
    type,
    title,
    originalTitle: originalTitle || title,
    year,
    genres,
    director: "TMDB",
    actors: [],
    description: item.overview || "Описание загружено из TMDB.",
    posterUrl: item.poster_path ? `${IMAGE_BASE_URL}/w500${item.poster_path}` : "",
    backdropUrl: item.backdrop_path ? `${IMAGE_BASE_URL}/original${item.backdrop_path}` : "",
    popularity: Number(Math.min(10, Math.max(1, (item.popularity ?? 0) / 40)).toFixed(1)),
    voteAverage,
    tags,
    moods,
    aspects: inferAspects(genres, voteAverage, tags),
    trailerUrl: ""
  };
}

async function collect(type, pages) {
  const endpoint = type === "series" ? "/discover/tv" : "/discover/movie";
  const items = [];
  for (let page = 1; page <= pages; page += 1) {
    const data = await tmdb(endpoint, {
      page,
      sort_by: "popularity.desc",
      "vote_count.gte": 200
    });
    items.push(...data.results.map((item) => mapResult(item, type)));
  }
  return items;
}

async function main() {
  if (!process.env.TMDB_BEARER_TOKEN && !process.env.TMDB_API_KEY) {
    throw new Error("Set TMDB_BEARER_TOKEN or TMDB_API_KEY before running import.");
  }

  const raw = await fs.readFile(DB_PATH, "utf8");
  const db = JSON.parse(raw);
  const existing = new Set(db.movies.map((movie) => movie.id));
  const imported = [...(await collect("movie", 4)), ...(await collect("series", 4))];
  const fresh = imported.filter((movie) => movie.title && movie.posterUrl && !existing.has(movie.id));
  db.movies.push(...fresh);
  await fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  console.log(`Imported ${fresh.length} new titles. Total movies: ${db.movies.length}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
