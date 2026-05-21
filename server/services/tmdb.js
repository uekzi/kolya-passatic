const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p";

function getAuthHeaders() {
  const token = process.env.TMDB_BEARER_TOKEN;
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

function withApiKey(url) {
  if (process.env.TMDB_BEARER_TOKEN || !process.env.TMDB_API_KEY) return url;
  url.searchParams.set("api_key", process.env.TMDB_API_KEY);
  return url;
}

async function tmdbRequest(path, params = {}) {
  const url = withApiKey(new URL(`${TMDB_BASE_URL}${path}`));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      ...getAuthHeaders()
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`TMDB request failed: ${response.status} ${message}`);
  }

  return response.json();
}

export function hasTmdbCredentials() {
  return Boolean(process.env.TMDB_BEARER_TOKEN || process.env.TMDB_API_KEY);
}

export async function searchTmdb(query) {
  return tmdbRequest("/search/multi", {
    query,
    language: "ru-RU",
    include_adult: "false"
  });
}

export async function discoverTmdb({ type = "movie", page = 1 } = {}) {
  const path = type === "series" ? "/discover/tv" : "/discover/movie";
  return tmdbRequest(path, {
    language: "ru-RU",
    sort_by: "popularity.desc",
    page
  });
}

export function mapTmdbResult(result, type = "movie") {
  const isSeries = type === "series" || result.media_type === "tv";
  const idPrefix = isSeries ? "tmdb_s" : "tmdb_m";
  const year = Number((result.release_date || result.first_air_date || "0").slice(0, 4)) || new Date().getFullYear();
  return {
    id: `${idPrefix}_${result.id}`,
    tmdbId: result.id,
    type: isSeries ? "series" : "movie",
    title: result.title || result.name || result.original_title || result.original_name,
    originalTitle: result.original_title || result.original_name || result.title || result.name,
    year,
    genres: [],
    director: "TMDB",
    actors: [],
    description: result.overview || "Описание будет загружено из TMDB.",
    posterUrl: result.poster_path ? `${IMAGE_BASE_URL}/w500${result.poster_path}` : "",
    backdropUrl: result.backdrop_path ? `${IMAGE_BASE_URL}/original${result.backdrop_path}` : "",
    popularity: Number((result.popularity / 20).toFixed(1)),
    voteAverage: result.vote_average ?? 0,
    tags: [],
    moods: [],
    aspects: { plot: 6, visual: 6, atmosphere: 6, dialogues: 6 },
    trailerUrl: ""
  };
}
