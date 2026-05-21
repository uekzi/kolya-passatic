import { TAG_LABELS } from "../data/seed.js";

const SECTION_LIMIT = 12;

const defaultPreferences = {
  genres: ["драма", "фантастика", "триллер"],
  tags: ["atmospheric", "visual_masterpiece", "smart_dialogue"],
  moods: ["атмосферное"],
  directors: [],
  aspects: {
    plot: 7,
    visual: 8,
    atmosphere: 8,
    dialogues: 7
  },
  configured: false
};

function overlapScore(values = [], preferences = [], weight = 1) {
  const pref = new Set(preferences);
  return values.reduce((score, value) => score + (pref.has(value) ? weight : 0), 0);
}

function aspectScore(movieAspects = {}, userAspects = {}) {
  const keys = ["plot", "visual", "atmosphere", "dialogues"];
  return keys.reduce((sum, key) => {
    const userWeight = Number(userAspects[key] ?? 5) / 10;
    const movieValue = Number(movieAspects[key] ?? 5) / 10;
    return sum + userWeight * movieValue;
  }, 0);
}

function buildReason(movie, preferences, scoreDetails) {
  const reasons = [];
  const matchedTags = movie.tags.filter((tag) => preferences.tags.includes(tag));
  const matchedGenres = movie.genres.filter((genre) => preferences.genres.includes(genre));
  const matchedMoods = movie.moods.filter((mood) => preferences.moods.includes(mood));

  if (matchedTags.length) {
    const readable = matchedTags.slice(0, 2).map((tag) => TAG_LABELS[tag] ?? tag).join(" и ");
    reasons.push(`совпадает с тегами «${readable}»`);
  }

  if (matchedGenres.length) {
    reasons.push(`попадает в любимые жанры: ${matchedGenres.slice(0, 2).join(", ")}`);
  }

  if (preferences.directors.includes(movie.director)) {
    reasons.push(`это работа режиссера ${movie.director}`);
  }

  if (matchedMoods.length) {
    reasons.push(`подходит под настроение «${matchedMoods[0]}»`);
  }

  if (scoreDetails.aspect > 2.6) {
    reasons.push("сильный визуал, атмосфера и сюжетный ритм совпадают с вашим профилем");
  }

  if (!reasons.length) {
    reasons.push("у фильма высокий пользовательский рейтинг и близкий набор жанров");
  }

  return `Вам может понравиться: ${reasons.slice(0, 2).join("; ")}.`;
}

function scoreMovie(movie, preferences, userRatings, favoriteIds, requestedMood) {
  const alreadyRated = userRatings.find((rating) => rating.movieId === movie.id);
  const genre = overlapScore(movie.genres, preferences.genres, 1.8);
  const tags = overlapScore(movie.tags, preferences.tags, 1.45);
  const mood = overlapScore(movie.moods, preferences.moods, 1.2) + (requestedMood && movie.moods.includes(requestedMood) ? 2.3 : 0);
  const director = preferences.directors.includes(movie.director) ? 2.1 : 0;
  const aspect = aspectScore(movie.aspects, preferences.aspects);
  const popularity = Math.min(movie.popularity / 10, 1) * 1.2;
  const vote = Math.min(movie.voteAverage / 10, 1) * 1.1;
  const favoriteBoost = favoriteIds.has(movie.id) ? 0.5 : 0;
  const ratedPenalty = alreadyRated ? 2.2 : 0;
  const novelty = movie.year >= 2023 ? 0.7 : 0;

  const tasteScore = genre + tags + mood + director + aspect;
  const rawScore = tasteScore * 0.74 + (popularity + vote + novelty) * 0.26 + favoriteBoost - ratedPenalty;
  const normalized = Math.max(52, Math.min(99, Math.round(rawScore * 8.2)));
  const details = { genre, tags, mood, director, aspect, popularity, vote, favoriteBoost, ratedPenalty, novelty, tasteScore };

  return {
    ...movie,
    matchScore: normalized,
    reason: buildReason(movie, preferences, details),
    isRated: Boolean(alreadyRated),
    userRating: alreadyRated?.rating ?? null
  };
}

export function scoreMovieForUser(movie, preferences, userRatings = [], favoriteIds = new Set(), requestedMood = "") {
  return scoreMovie(movie, preferences ?? defaultPreferences, userRatings, favoriteIds, requestedMood);
}

function enrichWithState(movie, ratings, favoriteIds) {
  const rating = ratings.find((item) => item.movieId === movie.id);
  return {
    ...movie,
    isFavorite: favoriteIds.has(movie.id),
    userRating: rating?.rating ?? null
  };
}

function byPopularity(a, b) {
  return b.popularity - a.popularity;
}

function byYearThenPopularity(a, b) {
  return b.year - a.year || b.popularity - a.popularity;
}

function byRecentPopularity(a, b) {
  const aScore = a.popularity * 0.7 + a.voteAverage * 0.3 + (a.year >= 2024 ? 1.2 : a.year >= 2022 ? 0.6 : 0);
  const bScore = b.popularity * 0.7 + b.voteAverage * 0.3 + (b.year >= 2024 ? 1.2 : b.year >= 2022 ? 0.6 : 0);
  return bScore - aScore;
}

function limit(items, count = SECTION_LIMIT) {
  return items.slice(0, count);
}

export function buildSections({ movies, user, userRatings = [], favorites = [], mood = "" }) {
  const preferences = user?.preferences ?? defaultPreferences;
  const favoriteIds = new Set(favorites.map((favorite) => favorite.movieId));
  const enriched = movies.map((movie) => enrichWithState(movie, userRatings, favoriteIds));
  const recommended = movies
    .map((movie) => scoreMovie(movie, preferences, userRatings, favoriteIds, mood))
    .sort((a, b) => b.matchScore - a.matchScore || b.popularity - a.popularity);

  return [
    {
      id: "new",
      title: "Новинки",
      subtitle: "Свежие фильмы и сериалы с высоким интересом аудитории",
      items: limit([...enriched].sort(byYearThenPopularity))
    },
    {
      id: "recommended",
      title: "Вам рекомендуем",
      subtitle: "Система ранжирует фильмы по вашему списку вкуса: жанры, теги, настроение, режиссеры и важные качества",
      items: limit(recommended)
    },
    {
      id: "users-choice",
      title: "Выбор пользователей",
      subtitle: "Картины с сильными оценками и стабильной популярностью",
      items: limit([...enriched].sort((a, b) => b.voteAverage - a.voteAverage || b.popularity - a.popularity))
    },
    {
      id: "popular-recent",
      title: "Популярно за последнее время",
      subtitle: "Фильмы и сериалы последних лет, которые чаще всего выбирают зрители",
      items: limit(enriched.filter((movie) => movie.year >= 2022).sort(byRecentPopularity))
    },
    {
      id: "romantic",
      title: "Отлично подойдет под романтический вечер",
      subtitle: "Тихие, разговорные и эмоциональные фильмы",
      items: limit(
        enriched
          .filter((movie) => movie.tags.includes("romantic_evening") || movie.genres.includes("мелодрама"))
          .sort(byPopularity)
      )
    },
    {
      id: "series",
      title: "Сериалы в тренде",
      subtitle: "Актуальные сериалы с выразительной атмосферой",
      items: limit(enriched.filter((movie) => movie.type === "series").sort(byPopularity))
    },
    {
      id: "children",
      title: "Детям",
      subtitle: "Анимация, семейные истории и легкое кино для спокойного просмотра",
      items: limit(
        enriched
          .filter(
            (movie) =>
              movie.tags.includes("family") ||
              movie.genres.includes("анимация") ||
              movie.genres.includes("семейный")
          )
          .sort(byPopularity)
      )
    }
  ];
}

export function buildRecommendationPool({ movies, user, userRatings = [], favorites = [], mood = "" }) {
  const preferences = user?.preferences ?? defaultPreferences;
  const favoriteIds = new Set(favorites.map((favorite) => favorite.movieId));
  return movies
    .map((movie) => scoreMovie(movie, preferences, userRatings, favoriteIds, mood))
    .sort((a, b) => b.matchScore - a.matchScore || b.popularity - a.popularity);
}

export function buildProfileStats({ movies, ratings, favorites }) {
  const byMovie = new Map(movies.map((movie) => [movie.id, movie]));
  const ratingByMovie = new Map(ratings.map((rating) => [rating.movieId, rating.rating]));
  const favoriteIds = new Set(favorites.map((favorite) => favorite.movieId));
  const genreStats = new Map();
  const tagStats = new Map();

  for (const rating of ratings) {
    const movie = byMovie.get(rating.movieId);
    if (!movie) continue;
    for (const genre of movie.genres) {
      const current = genreStats.get(genre) ?? { genre, total: 0, count: 0 };
      current.total += rating.rating;
      current.count += 1;
      genreStats.set(genre, current);
    }
    for (const tag of movie.tags) {
      const current = tagStats.get(tag) ?? { tag, total: 0, count: 0 };
      current.total += rating.rating;
      current.count += 1;
      tagStats.set(tag, current);
    }
  }

  const topGenres = [...genreStats.values()]
    .map((item) => ({ genre: item.genre, average: Number((item.total / item.count).toFixed(1)), count: item.count }))
    .sort((a, b) => b.average - a.average || b.count - a.count)
    .slice(0, 6);

  const topTags = [...tagStats.values()]
    .map((item) => ({ tag: item.tag, label: TAG_LABELS[item.tag] ?? item.tag, average: Number((item.total / item.count).toFixed(1)), count: item.count }))
    .sort((a, b) => b.average - a.average || b.count - a.count)
    .slice(0, 6);

  const enrich = (movie) => ({
    ...movie,
    isFavorite: favoriteIds.has(movie.id),
    userRating: ratingByMovie.get(movie.id) ?? null
  });

  const favoriteMovies = favorites
    .map((favorite) => byMovie.get(favorite.movieId))
    .filter(Boolean)
    .map(enrich);

  const popularRecent = movies
    .filter((movie) => movie.year >= 2022)
    .sort(byRecentPopularity)
    .slice(0, 8)
    .map(enrich);

  return {
    ratingsCount: ratings.length,
    favoritesCount: favorites.length,
    averageRating: ratings.length ? Number((ratings.reduce((sum, item) => sum + item.rating, 0) / ratings.length).toFixed(1)) : 0,
    topGenres,
    topTags,
    favoriteMovies,
    popularRecent
  };
}

export function getDefaultPreferences() {
  return defaultPreferences;
}
