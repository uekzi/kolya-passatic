import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Heart,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Star,
  TrendingUp,
  UserRound,
  WandSparkles,
  X
} from "lucide-react";
import { api } from "./api.js";
import "./styles.css";

const GENRES = ["фантастика", "драма", "триллер", "комедия", "мелодрама", "приключения", "детектив", "анимация", "семейный", "исторический", "фэнтези", "боевик"];
const TAGS = [
  ["visual_masterpiece", "визуальный шедевр"],
  ["philosophical", "философский"],
  ["smart_dialogue", "умные диалоги"],
  ["atmospheric", "атмосферный"],
  ["slow_pace", "медленный темп"],
  ["romantic_evening", "романтический вечер"],
  ["mind_bending", "ломает голову"],
  ["comfort", "уютный"]
];
const MOODS = ["атмосферное", "задумчивое", "романтичное", "легкое", "напряженное", "эпичное", "тихое"];
const DIRECTORS = ["Дени Вильнев", "Кристофер Нолан", "Дэмьен Шазелл", "Пон Джун-хо", "Уэс Андерсон", "Спайк Джонз"];
const TYPE_FILTERS = [
  ["", "Все"],
  ["movie", "Фильмы"],
  ["series", "Сериалы"]
];
const RATING_LABELS = {
  1: "Плохо",
  2: "Слабо",
  3: "Слабо",
  4: "Слабо",
  5: "Нормально",
  6: "Выше среднего",
  7: "Хорошо",
  8: "Отлично",
  9: "Почти шедевр",
  10: "Шедевр"
};

const emptyLogin = { email: "", password: "", displayName: "" };
const initialRegistrationPreferences = {
  genres: [],
  tags: [],
  moods: [],
  directors: [],
  aspects: { plot: 7, visual: 7, atmosphere: 7, dialogues: 7 },
  configured: false
};

function hasTasteSelection(preferences) {
  return (
    preferences.genres.length > 0 ||
    preferences.tags.length > 0 ||
    preferences.moods.length > 0 ||
    preferences.directors.length > 0
  );
}

function ratingTone(value) {
  const rating = Number(value);
  if (rating >= 8) return "green";
  if (rating >= 5) return "yellow";
  if (rating >= 1) return "red";
  return "empty";
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem("kinoMoodToken") || "");
  const [sections, setSections] = useState([]);
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [activeView, setActiveView] = useState("home");
  const [activeMood, setActiveMood] = useState("");
  const [query, setQuery] = useState("");
  const [searchFilters, setSearchFilters] = useState({ type: "", genre: "", tag: "", mood: "" });
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const latestSearchKey = useRef("");
  const [recommendationPool, setRecommendationPool] = useState([]);
  const [randomMovie, setRandomMovie] = useState(null);
  const [randomIndex, setRandomIndex] = useState(0);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState(emptyLogin);
  const [registerPrefs, setRegisterPrefs] = useState(initialRegistrationPreferences);
  const [authError, setAuthError] = useState("");
  const [isPrefsOpen, setPrefsOpen] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [loading, setLoading] = useState(true);

  const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  useEffect(() => {
    function handleTokenRotation(event) {
      setToken(event.detail);
    }

    window.addEventListener("kino-token-rotated", handleTokenRotation);
    return () => window.removeEventListener("kino-token-rotated", handleTokenRotation);
  }, []);

  useEffect(() => {
    const savedToken = localStorage.getItem("kinoMoodToken");
    if (!savedToken) return;

    api("/api/auth/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${savedToken}` }
    })
      .then((payload) => {
        localStorage.setItem("kinoMoodToken", payload.token);
        setToken(payload.token);
        setUser(payload.user);
      })
      .catch(() => {
        localStorage.removeItem("kinoMoodToken");
        setToken("");
        setUser(null);
      });
  }, []);

  async function loadSections(mood = activeMood, { showLoading = true } = {}) {
    if (showLoading) setLoading(true);
    try {
      const data = await api(`/api/sections${mood ? `?mood=${encodeURIComponent(mood)}` : ""}`, {
        headers: authHeaders
      });
      setSections(data.sections);
      if (data.user) setUser(data.user);
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function loadRecommendationPool(mood = activeMood) {
    const data = await api(`/api/recommendations/pool${mood ? `?mood=${encodeURIComponent(mood)}` : ""}`, {
      headers: authHeaders
    });
    setRecommendationPool(data.items);
    return data.items;
  }

  async function loadProfile() {
    if (!token) return;
    const data = await api("/api/me", { headers: authHeaders });
    setUser(data.user);
    setStats(data.stats);
  }

  useEffect(() => {
    loadSections();
  }, [token]);

  useEffect(() => {
    loadRecommendationPool();
  }, [token, activeMood]);

  useEffect(() => {
    if (activeView === "profile") loadProfile();
  }, [activeView, token]);

  useEffect(() => {
    const controller = new AbortController();
    const trimmedQuery = query.trim();
    const hasFilters = Object.values(searchFilters).some(Boolean);
    const searchKey = JSON.stringify({ query: trimmedQuery, filters: searchFilters });
    latestSearchKey.current = searchKey;

    async function searchMovies() {
      if (!trimmedQuery && !hasFilters) {
        setSearchResults([]);
        setSearchLoading(false);
        return;
      }

      const params = new URLSearchParams();
      if (trimmedQuery) params.set("query", trimmedQuery);
      for (const [key, value] of Object.entries(searchFilters)) {
        if (value) params.set(key, value);
      }

      setSearchLoading(true);
      const data = await api(`/api/movies?${params.toString()}`, {
        headers: authHeaders,
        signal: controller.signal
      });
      if (controller.signal.aborted || latestSearchKey.current !== searchKey) return;
      setSearchResults(data.items);
      setSearchLoading(false);
    }
    searchMovies().catch((error) => {
      if (error.name !== "AbortError") console.error(error);
      setSearchLoading(false);
    });
    return () => controller.abort();
  }, [query, searchFilters, token]);

  async function handleAuth(event) {
    event.preventDefault();
    setAuthError("");
    const selectedRegistrationPreferences = {
      ...registerPrefs,
      configured: hasTasteSelection(registerPrefs)
    };
    try {
      const payload = await api(authMode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          ...authForm,
          preferences:
            authMode === "register"
              ? selectedRegistrationPreferences
              : user?.preferences
        })
      });
      localStorage.setItem("kinoMoodToken", payload.token);
      setToken(payload.token);
      setUser(payload.user);
      setAuthForm(emptyLogin);
      if (authMode === "register") {
        if (selectedRegistrationPreferences.configured) {
          const updated = await api("/api/me/preferences", {
            method: "PUT",
            headers: { Authorization: `Bearer ${payload.token}` },
            body: JSON.stringify({ preferences: selectedRegistrationPreferences })
          });
          setUser(updated.user);
        } else if (!payload.user.preferences?.configured) {
          setPrefsOpen(true);
        }
        setRegisterPrefs(initialRegistrationPreferences);
        setActiveView("home");
      }
    } catch (error) {
      setAuthError(error.message);
    }
  }

  async function demoLogin() {
    const payload = await api("/api/auth/demo", { method: "POST" });
    localStorage.setItem("kinoMoodToken", payload.token);
    setToken(payload.token);
    setUser(payload.user);
    setAuthError("");
  }

  function logout() {
    localStorage.removeItem("kinoMoodToken");
    setToken("");
    setUser(null);
    setStats(null);
    setActiveView("home");
  }

  async function rateMovie(movieId, rating) {
    if (!token) {
      setActiveView("auth");
      return;
    }
    await api(`/api/movies/${movieId}/rate`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ rating: Number(rating) })
    });
    patchMovie(movieId, { userRating: Number(rating) });
    await loadSections(activeMood, { showLoading: false });
    await loadRecommendationPool(activeMood);
    if (activeView === "profile") await loadProfile();
  }

  async function toggleFavorite(movieId) {
    if (!token) {
      setActiveView("auth");
      return;
    }
    const result = await api(`/api/movies/${movieId}/favorite`, {
      method: "POST",
      headers: authHeaders
    });
    patchMovie(movieId, { isFavorite: result.favorite });
    if (activeView === "profile") await loadProfile();
  }

  function patchMovie(movieId, patch) {
    const patchItem = (movie) => (movie.id === movieId ? { ...movie, ...patch } : movie);
    setSections((current) =>
      current.map((section) => ({
        ...section,
        items: section.items.map(patchItem)
      }))
    );
    setSearchResults((current) => current.map(patchItem));
    setRecommendationPool((current) => current.map(patchItem));
    setRandomMovie((current) => (current?.id === movieId ? { ...current, ...patch } : current));
    setSelectedMovie((current) => (current?.id === movieId ? { ...current, ...patch } : current));
  }

  async function pickMood(mood) {
    const next = activeMood === mood ? "" : mood;
    setActiveMood(next);
    await loadSections(next);
  }

  async function openRandomRecommendation() {
    const pool = recommendationPool.length ? recommendationPool : await loadRecommendationPool();
    if (!pool.length) return;
    setRandomIndex((current) => {
      const next = current % pool.length;
      setRandomMovie(pool[next]);
      return next + 1;
    });
  }

  function nextRandomRecommendation() {
    const pool = recommendationPool.length;
    if (!pool) return;
    setRandomIndex((current) => {
      const next = current % recommendationPool.length;
      setRandomMovie(recommendationPool[next]);
      return next + 1;
    });
  }

  return (
    <div className="app-shell">
      <TopBar
        user={user}
        activeView={activeView}
        onNavigate={setActiveView}
        onPrefs={() => setPrefsOpen(true)}
        onLogout={logout}
      />

      <main className="page">
        {activeView === "home" && (
          <HomeView
            user={user}
            sections={sections}
            loading={loading}
            activeMood={activeMood}
            onMood={pickMood}
            onPrefs={() => setPrefsOpen(true)}
            onAuth={() => setActiveView("auth")}
            onRandom={openRandomRecommendation}
            onRate={rateMovie}
            onFavorite={toggleFavorite}
            onDetails={setSelectedMovie}
          />
        )}

        {activeView === "search" && (
          <SearchView
            query={query}
            setQuery={setQuery}
            filters={searchFilters}
            setFilters={setSearchFilters}
            items={searchResults}
            loading={searchLoading}
            onRate={rateMovie}
            onFavorite={toggleFavorite}
            onDetails={setSelectedMovie}
          />
        )}

        {activeView === "profile" && (
          <ProfileView
            user={user}
            stats={stats}
            onPrefs={() => setPrefsOpen(true)}
            onAuth={() => setActiveView("auth")}
            onRate={rateMovie}
            onFavorite={toggleFavorite}
            onDetails={setSelectedMovie}
          />
        )}

        {activeView === "auth" && (
          <AuthView
            mode={authMode}
            setMode={setAuthMode}
            form={authForm}
            setForm={setAuthForm}
            preferences={registerPrefs}
            setPreferences={setRegisterPrefs}
            error={authError}
            onSubmit={handleAuth}
            onDemo={demoLogin}
          />
        )}
      </main>

      <SiteFooter />

      {isPrefsOpen && (
        <PreferencesModal
          user={user}
          token={token}
          authHeaders={authHeaders}
          onClose={() => setPrefsOpen(false)}
          onSave={(updatedUser) => {
            setUser(updatedUser);
            setPrefsOpen(false);
            loadSections();
          }}
          onNeedAuth={() => {
            setPrefsOpen(false);
            setActiveView("auth");
          }}
        />
      )}

      {selectedMovie && (
        <MovieModal
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
          onRate={rateMovie}
          onFavorite={toggleFavorite}
        />
      )}

      {randomMovie && (
        <RandomMovieModal
          movie={randomMovie}
          onClose={() => setRandomMovie(null)}
          onNext={nextRandomRecommendation}
          onRate={rateMovie}
          onFavorite={toggleFavorite}
          onDetails={(movie) => {
            setRandomMovie(null);
            setSelectedMovie(movie);
          }}
        />
      )}
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <strong>KinoMood</strong>
        <p>Интеллектуальный подбор фильмов и сериалов под вкус, настроение и контекст просмотра.</p>
      </div>
      <div>
        <span>Контакты</span>
        <a href="mailto:hello@kinomood.local">hello@kinomood.local</a>
        <a href="tel:+78632005590">+7 863 200-55-90</a>
      </div>
      <div>
        <span>О нас</span>
        <p>Ростов-на-Дону, учебный дипломный проект по специальности 09.02.07.</p>
      </div>
      <div>
        <span>Документы</span>
        <p>Политика конфиденциальности · Пользовательское соглашение · Поддержка</p>
      </div>
    </footer>
  );
}

function TopBar({ user, activeView, onNavigate, onPrefs, onLogout }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => onNavigate("home")} aria-label="KinoMood">
        <Clapperboard size={24} />
        <span>KinoMood</span>
      </button>

      <nav className="nav-tabs" aria-label="Основная навигация">
        <button className={activeView === "home" ? "active" : ""} onClick={() => onNavigate("home")}>
          <Sparkles size={18} />
          Главная
        </button>
        <button className={activeView === "search" ? "active" : ""} onClick={() => onNavigate("search")}>
          <Search size={18} />
          Поиск
        </button>
        <button className={activeView === "profile" ? "active" : ""} onClick={() => onNavigate("profile")}>
          <UserRound size={18} />
          Профиль
        </button>
      </nav>

      <div className="topbar-actions">
        <button className="icon-button" onClick={onPrefs} title="Настройки вкуса" aria-label="Настройки вкуса">
          <Settings2 size={19} />
        </button>
        {user ? (
          <>
            <span className="user-chip">{user.displayName}</span>
            <button className="icon-button" onClick={onLogout} title="Выйти" aria-label="Выйти">
              <LogOut size={19} />
            </button>
          </>
        ) : (
          <button className="auth-button" onClick={() => onNavigate("auth")}>
            <LogIn size={18} />
            Войти
          </button>
        )}
      </div>
    </header>
  );
}

function HomeView({ user, sections, loading, activeMood, onMood, onPrefs, onAuth, onRandom, onRate, onFavorite, onDetails }) {
  const recommended = sections.find((section) => section.id === "recommended");
  const usersChoice = sections.find((section) => section.id === "users-choice");
  const heroPool = (usersChoice?.items?.length ? usersChoice.items : recommended?.items ?? []).slice(0, 10);
const [heroIndex, setHeroIndex] = useState(0);
const [heroVisible, setHeroVisible] = useState(true);
const focusMovie =
  heroPool[heroIndex % Math.max(heroPool.length, 1)] ??
  recommended?.items?.[0];
  const needsTasteSetup = !user || !user.preferences?.configured;

  useEffect(() => {
  if (heroPool.length <= 1) return undefined;

  const timer = window.setInterval(() => {
    setHeroVisible(false);

    setTimeout(() => {
      setHeroIndex((current) => (current + 1) % heroPool.length);
      setHeroVisible(true);
    }, 400);
  }, 10000);

  return () => window.clearInterval(timer);
}, [heroPool.length]);

  return (
    <div className="home-view">
      {needsTasteSetup && (
        <section className="taste-banner">
          <div>
            <p className="eyebrow">Список вкуса</p>
            <h2>Настройте подбор под себя</h2>
            <p>Рекомендации станут точнее, когда вы отметите любимые жанры, теги, настроение, режиссеров и важность сюжета, визуала, атмосферы и диалогов.</p>
          </div>
          <button className="primary-button" onClick={user ? onPrefs : onAuth}>
            <Settings2 size={18} />
            Настроить вкус
          </button>
        </section>
      )}

      <section className={`focus-band ${heroVisible ? "hero-visible" : "hero-hidden"}`}>
        <div className="focus-copy">
          <p className="eyebrow">Интеллектуальный подбор</p>
          <h1>{focusMovie ? focusMovie.title : "Кино под настроение"}</h1>
          <p>{focusMovie?.reason ?? "Сервис анализирует жанры, темп, атмосферу, визуал, диалоги и ваши оценки."}</p>
          {focusMovie?.genres?.length > 0 && (
            <div className="hero-genres">
              {focusMovie.genres.slice(0, 4).map((genre) => (
                <span key={genre}>{genre}</span>
              ))}
            </div>
          )}
          {user?.preferences?.configured && <TasteSummary preferences={user.preferences} />}
          <div className="mood-strip">
            {MOODS.map((mood) => (
              <button key={mood} className={activeMood === mood ? "selected" : ""} onClick={() => onMood(mood)}>
                {mood}
              </button>
            ))}
          </div>
          <button className="random-button" onClick={onRandom}>
            <Shuffle size={18} />
            Подобрать фильм для меня
          </button>
        </div>
        <div className="focus-poster" style={{ backgroundImage: `url(${focusMovie?.backdropUrl || focusMovie?.posterUrl || ""})` }}>
          <div className="focus-score">
            <WandSparkles size={19} />
            {focusMovie?.matchScore ?? 86}%
          </div>
        </div>
      </section>

      {loading ? (
        <div className="loading-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <div className="skeleton-card" key={index} />
          ))}
        </div>
      ) : (
        sections.map((section, index) => (
          <MovieRail
            key={section.id}
            section={section}
            index={index}
            onRate={onRate}
            onFavorite={onFavorite}
            onDetails={onDetails}
          />
        ))
      )}
    </div>
  );
}

function TasteSummary({ preferences }) {
  const tasteItems = [
    ...(preferences.genres ?? []).slice(0, 3),
    ...(preferences.tags ?? []).slice(0, 2).map((tag) => `#${tag.replaceAll("_", " ")}`),
    ...(preferences.directors ?? []).slice(0, 1)
  ];

  return (
    <div className="taste-summary" aria-label="Ваш список вкуса">
      <ShieldCheck size={17} />
      {tasteItems.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

function MovieRail({ section, index, onRate, onFavorite, onDetails }) {
  const railRef = useRef(null);
  const direction = index % 2 === 0 ? "left" : "right";
  const repeatedItems = [...section.items, ...section.items];

  function scrollRail(multiplier) {
    const node = railRef.current;
    if (!node) return;
    node.scrollBy({ left: multiplier * Math.min(760, node.clientWidth * 0.82), behavior: "smooth" });
  }

  return (
    <section className="movie-section">
      <div className="section-heading">
        <div>
          <h2>{section.title}</h2>
          <p>{section.subtitle}</p>
        </div>
        <div className="rail-controls">
          <button onClick={() => scrollRail(-1)} aria-label={`Листать назад: ${section.title}`}>
            <ChevronLeft size={20} />
          </button>
          <button onClick={() => scrollRail(1)} aria-label={`Листать вперед: ${section.title}`}>
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
      <div className="movie-rail" ref={railRef}>
        <div className={`movie-rail-track drift-${direction}`}>
          {repeatedItems.map((movie, itemIndex) => (
            <MovieCard
              key={`${section.id}-${movie.id}-${itemIndex}`}
              movie={movie}
              onRate={onRate}
              onFavorite={onFavorite}
              onDetails={onDetails}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function MovieCard({ movie, onRate, onFavorite, onDetails }) {
  return (
    <article className="movie-card">
      <button className="poster-button" onClick={() => onDetails(movie)} aria-label={`Открыть ${movie.title}`}>
        <img src={movie.posterUrl} alt={movie.title} loading="lazy" />
        {movie.matchScore && <span className="match-badge">{movie.matchScore}%</span>}
      </button>
      <div className="movie-card-body">
        <div>
          <div className="movie-meta">
            <span>{movie.year}</span>
            <span>{movie.type === "series" ? "сериал" : "фильм"}</span>
          </div>
          <h3>{movie.title}</h3>
        </div>
        <p className="movie-reason">{movie.reason || movie.description}</p>
        <div className="tag-row">
          {movie.tags.slice(0, 3).map((tag) => (
            <span key={tag}>#{tag.replaceAll("_", " ")}</span>
          ))}
        </div>
        <div className="card-actions">
          <RatingPicker value={movie.userRating} onChange={(rating) => onRate(movie.id, rating)} compact />
          <button className={movie.isFavorite ? "heart active" : "heart"} onClick={() => onFavorite(movie.id)} aria-label="Избранное">
            <Heart size={17} fill={movie.isFavorite ? "currentColor" : "none"} />
          </button>
        </div>
      </div>
    </article>
  );
}

function RatingPicker({ value, onChange, compact = false }) {
  const [open, setOpen] = useState(false);
  const tone = ratingTone(value);

  function pickRating(rating) {
    onChange(rating);
    setOpen(false);
  }

  return (
    <div className={compact ? "rating-picker compact" : "rating-picker"}>
      <button className={`rating-trigger rating-${tone}`} type="button" onClick={() => setOpen((current) => !current)}>
        <Star size={16} fill={value ? "currentColor" : "none"} />
        <span>{value ? `${value}/10` : "Оценка"}</span>
        <ChevronRight size={15} />
      </button>
      {open && (
        <div className="rating-menu">
          {Array.from({ length: 10 }).map((_, index) => {
            const rating = index + 1;
            const itemTone = ratingTone(rating);
            return (
              <button
                key={rating}
                type="button"
                className={`rating-option rating-${itemTone} ${value === rating ? "selected" : ""}`}
                onClick={() => pickRating(rating)}
              >
                <strong>{rating}</strong>
                <span>{RATING_LABELS[rating]}</span>
                <span className="rating-stars" aria-hidden="true">
                  {Array.from({ length: 10 }).map((__, starIndex) => (
                    <Star key={starIndex} size={11} fill={starIndex < rating ? "currentColor" : "none"} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SearchView({ query, setQuery, filters, setFilters, items, loading, onRate, onFavorite, onDetails }) {
  function updateFilter(key, value) {
    setFilters({ ...filters, [key]: value });
  }

  return (
    <div className="search-view">
      <div className="search-panel">
        <Search size={22} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, жанр, режиссер" />
      </div>
      <div className="filter-panel">
        <div className="filter-title">
          <SlidersHorizontal size={18} />
          <span>Фильтры</span>
        </div>
        <select value={filters.type} onChange={(event) => updateFilter("type", event.target.value)}>
          {TYPE_FILTERS.map(([value, label]) => (
            <option key={label} value={value}>{label}</option>
          ))}
        </select>
        <select value={filters.genre} onChange={(event) => updateFilter("genre", event.target.value)}>
          <option value="">Любой жанр</option>
          {GENRES.map((genre) => (
            <option key={genre} value={genre}>{genre}</option>
          ))}
        </select>
        <select value={filters.tag} onChange={(event) => updateFilter("tag", event.target.value)}>
          <option value="">Любой тег</option>
          {TAGS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select value={filters.mood} onChange={(event) => updateFilter("mood", event.target.value)}>
          <option value="">Любое настроение</option>
          {MOODS.map((mood) => (
            <option key={mood} value={mood}>{mood}</option>
          ))}
        </select>
      </div>
      <div className="catalog-grid">
        {loading ? (
          Array.from({ length: 12 }).map((_, index) => (
            <div className="skeleton-card" key={index} />
          ))
        ) : (
          items.map((movie) => (
            <MovieCard key={movie.id} movie={movie} onRate={onRate} onFavorite={onFavorite} onDetails={onDetails} />
          ))
        )}
      </div>
      {!items.length && (query || Object.values(filters).some(Boolean)) && (
        <div className="profile-empty">По таким фильтрам пока ничего не найдено</div>
      )}
    </div>
  );
}

function ProfileView({ user, stats, onPrefs, onAuth, onRate, onFavorite, onDetails }) {
  if (!user) {
    return (
      <div className="empty-state">
        <UserRound size={40} />
        <h2>Профиль недоступен</h2>
        <button className="primary-button" onClick={onAuth}>Войти</button>
      </div>
    );
  }

  return (
    <div className="profile-view">
      <section className="profile-header">
        <div>
          <p className="eyebrow">Личный кабинет</p>
          <h1>{user.displayName}</h1>
          <p>{user.email}</p>
        </div>
        <button className="primary-button" onClick={onPrefs}>
          <Settings2 size={18} />
          Предпочтения
        </button>
      </section>

      <section className="stats-grid">
        <Metric label="Оценок" value={stats?.ratingsCount ?? 0} />
        <Metric label="Избранное" value={stats?.favoritesCount ?? 0} />
        <Metric label="Средняя оценка" value={stats?.averageRating ?? 0} />
      </section>

      <section className="profile-columns">
        <PreferenceBlock title="Любимые жанры" items={stats?.topGenres?.map((item) => `${item.genre} ${item.average}`) ?? user.preferences.genres} />
        <PreferenceBlock title="Сильные теги" items={stats?.topTags?.map((item) => `${item.label} ${item.average}`) ?? user.preferences.tags} />
        <PreferenceBlock title="Режиссеры" items={user.preferences.directors} />
      </section>

      <ProfileMovieBlock
        title="Избранные фильмы и сериалы"
        subtitle="Все, что пользователь добавил в свой список"
        items={stats?.favoriteMovies ?? []}
        emptyText="В избранном пока пусто"
        onRate={onRate}
        onFavorite={onFavorite}
        onDetails={onDetails}
      />

      <ProfileMovieBlock
        title="Популярно за последнее время"
        subtitle="Свежие фильмы и сериалы с высоким интересом аудитории"
        items={stats?.popularRecent ?? []}
        emptyText="Популярные фильмы появятся после загрузки базы"
        onRate={onRate}
        onFavorite={onFavorite}
        onDetails={onDetails}
      />
    </div>
  );
}

function ProfileMovieBlock({ title, subtitle, items, emptyText, onRate, onFavorite, onDetails }) {
  return (
    <section className="profile-movie-block">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {title.includes("Популярно") && <TrendingUp size={24} />}
      </div>
      {items.length ? (
        <div className="profile-movie-grid">
          {items.map((movie) => (
            <MovieCard
              key={`${title}-${movie.id}`}
              movie={movie}
              onRate={onRate}
              onFavorite={onFavorite}
              onDetails={onDetails}
            />
          ))}
        </div>
      ) : (
        <div className="profile-empty">{emptyText}</div>
      )}
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PreferenceBlock({ title, items }) {
  return (
    <div className="preference-block">
      <h3>{title}</h3>
      <div className="pill-list">
        {items.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function AuthView({ mode, setMode, form, setForm, preferences, setPreferences, error, onSubmit, onDemo }) {
  function togglePreference(key, value) {
    const next = new Set(preferences[key]);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setPreferences({ ...preferences, [key]: [...next] });
  }

  return (
    <div className="auth-view">
      <form className="auth-panel" onSubmit={onSubmit}>
        <p className="eyebrow">{mode === "login" ? "Авторизация" : "Регистрация"}</p>
        <h1>{mode === "login" ? "Вход в сервис" : "Новый профиль"}</h1>
        {mode === "register" && (
          <input
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            placeholder="Имя"
          />
        )}
        <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email" />
        <input
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          placeholder="Пароль"
          type="password"
        />
        {error && <p className="form-error">{error}</p>}
        {mode === "register" && (
          <div className="register-taste">
            <div>
              <p className="eyebrow">Выберите интересы</p>
              <h2>Что вам ближе?</h2>
            </div>
            <CompactPicker
              title="Жанры"
              items={GENRES.slice(0, 7)}
              values={preferences.genres}
              onToggle={(value) => togglePreference("genres", value)}
            />
            <CompactPicker
              title="Настроение"
              items={MOODS.slice(0, 6)}
              values={preferences.moods}
              onToggle={(value) => togglePreference("moods", value)}
            />
            <CompactPicker
              title="Киноязык"
              items={TAGS.slice(0, 6).map(([value, label]) => ({ value, label }))}
              values={preferences.tags}
              onToggle={(value) => togglePreference("tags", value)}
            />
          </div>
        )}
        <button className="primary-button" type="submit">
          <LogIn size={18} />
          {mode === "login" ? "Войти" : "Создать"}
        </button>
        <button className="ghost-button" type="button" onClick={onDemo}>Демо-вход</button>
        <button className="link-button" type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Создать аккаунт" : "Уже есть аккаунт"}
        </button>
      </form>
    </div>
  );
}

function CompactPicker({ title, items, values, onToggle }) {
  return (
    <div className="compact-picker">
      <span>{title}</span>
      <div className="compact-pill-list">
        {items.map((item) => {
          const value = typeof item === "string" ? item : item.value;
          const label = typeof item === "string" ? item : item.label;
          return (
            <button key={value} type="button" className={values.includes(value) ? "selected" : ""} onClick={() => onToggle(value)}>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PreferencesModal({ user, token, authHeaders, onClose, onSave, onNeedAuth }) {
  const [draft, setDraft] = useState(
    user?.preferences ?? {
      genres: ["фантастика", "драма"],
      tags: ["visual_masterpiece", "atmospheric"],
      moods: ["атмосферное"],
      directors: ["Дени Вильнев"],
      aspects: { plot: 8, visual: 9, atmosphere: 9, dialogues: 7 },
      configured: false
    }
  );

  function toggleList(key, value) {
    const values = new Set(draft[key]);
    if (values.has(value)) values.delete(value);
    else values.add(value);
    setDraft({ ...draft, [key]: [...values] });
  }

  async function save() {
    if (!token) {
      onNeedAuth();
      return;
    }
    const data = await api("/api/me/preferences", {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ preferences: { ...draft, configured: true } })
    });
    onSave(data.user);
  }

  return (
    <div className="modal-backdrop">
      <section className="prefs-modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Анкета вкуса</p>
            <h2>Настройки рекомендаций</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <Picker title="Жанры" items={GENRES} values={draft.genres} onToggle={(value) => toggleList("genres", value)} />
        <Picker title="Теги" items={TAGS.map(([value, label]) => ({ value, label }))} values={draft.tags} onToggle={(value) => toggleList("tags", value)} />
        <Picker title="Настроение" items={MOODS} values={draft.moods} onToggle={(value) => toggleList("moods", value)} />
        <Picker title="Режиссеры" items={DIRECTORS} values={draft.directors} onToggle={(value) => toggleList("directors", value)} />

        <div className="slider-grid">
          {[
            ["plot", "Сюжет"],
            ["visual", "Визуал"],
            ["atmosphere", "Атмосфера"],
            ["dialogues", "Диалоги"]
          ].map(([key, label]) => (
            <label key={key} className="range-control">
              <span>{label}</span>
              <input
                type="range"
                min="1"
                max="10"
                value={draft.aspects[key]}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    aspects: { ...draft.aspects, [key]: Number(event.target.value) }
                  })
                }
              />
              <strong>{draft.aspects[key]}</strong>
            </label>
          ))}
        </div>

        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose}>Закрыть</button>
          <button className="primary-button" onClick={save}>
            <WandSparkles size={18} />
            Сохранить
          </button>
        </div>
      </section>
    </div>
  );
}

function Picker({ title, items, values, onToggle }) {
  return (
    <div className="picker">
      <h3>{title}</h3>
      <div className="pill-list">
        {items.map((item) => {
          const value = typeof item === "string" ? item : item.value;
          const label = typeof item === "string" ? item : item.label;
          return (
            <button key={value} className={values.includes(value) ? "selected" : ""} onClick={() => onToggle(value)}>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MovieModal({ movie, onClose, onRate, onFavorite }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="movie-modal" onClick={(event) => event.stopPropagation()}>
        <button className="icon-button close-float" onClick={onClose} aria-label="Закрыть">
          <X size={20} />
        </button>
        <div className="movie-modal-media">
          <img src={movie.backdropUrl || movie.posterUrl} alt={movie.title} loading="eager" />
        </div>
        <div className="movie-modal-content">
          <p className="eyebrow">{movie.year} · {movie.genres.join(", ")}</p>
          <h2>{movie.title}</h2>
          <p>{movie.description}</p>
          {movie.reason && <p className="reason-box">{movie.reason}</p>}
          <div className="modal-facts">
            <span>Режиссер: {movie.director}</span>
            <span>Рейтинг: {movie.voteAverage}</span>
            <span>{movie.actors.slice(0, 3).join(", ")}</span>
          </div>
          <div className="modal-actions">
            <RatingPicker value={movie.userRating} onChange={(rating) => onRate(movie.id, rating)} />
            <button className="primary-button" onClick={() => onFavorite(movie.id)}>
              <Heart size={18} />
              Избранное
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function RandomMovieModal({ movie, onClose, onNext, onRate, onFavorite, onDetails }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="random-modal" onClick={(event) => event.stopPropagation()}>
        <button className="icon-button close-float" onClick={onClose} aria-label="Закрыть">
          <X size={20} />
        </button>
        <img src={movie.posterUrl} alt={movie.title} />
        <div className="random-modal-content">
          <p className="eyebrow">Персональный выбор</p>
          <h2>{movie.title}</h2>
          <div className="hero-genres">
            {movie.genres.slice(0, 4).map((genre) => (
              <span key={genre}>{genre}</span>
            ))}
          </div>
          <p>{movie.reason || movie.description}</p>
          <div className="random-score">
            <WandSparkles size={18} />
            Совпадение {movie.matchScore ?? 80}%
          </div>
          <div className="modal-actions">
            <button className="ghost-button" onClick={onNext}>
              <RefreshCw size={18} />
              Следующий фильм
            </button>
            <button className="primary-button" onClick={() => onDetails(movie)}>
              Подробнее
            </button>
            <button className={movie.isFavorite ? "heart active" : "heart"} onClick={() => onFavorite(movie.id)} aria-label="Избранное">
              <Heart size={18} fill={movie.isFavorite ? "currentColor" : "none"} />
            </button>
          </div>
          <RatingPicker value={movie.userRating} onChange={(rating) => onRate(movie.id, rating)} />
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
