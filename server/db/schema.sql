CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(100) UNIQUE NOT NULL,
  display_name varchar(100) NOT NULL,
  password_hash varchar(255) NOT NULL,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS movies (
  id varchar(80) PRIMARY KEY,
  tmdb_id integer UNIQUE,
  type varchar(20) NOT NULL CHECK (type IN ('movie', 'series')),
  title varchar(200) NOT NULL,
  original_title varchar(200),
  year integer NOT NULL CHECK (year BETWEEN 1900 AND 2035),
  genres text[] NOT NULL DEFAULT '{}',
  director varchar(120),
  actors text[] NOT NULL DEFAULT '{}',
  description text NOT NULL,
  poster_url varchar(500),
  backdrop_url varchar(500),
  popularity numeric(5, 2) NOT NULL DEFAULT 0,
  vote_average numeric(3, 1) NOT NULL DEFAULT 0,
  tags text[] NOT NULL DEFAULT '{}',
  moods text[] NOT NULL DEFAULT '{}',
  aspects jsonb NOT NULL DEFAULT '{}'::jsonb,
  trailer_url varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ratings (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id varchar(80) NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 10),
  rated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, movie_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id varchar(80) NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, movie_id)
);

CREATE TABLE IF NOT EXISTS user_movie_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  movie_id varchar(80) REFERENCES movies(id) ON DELETE CASCADE,
  event_type varchar(40) NOT NULL,
  event_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_similarities (
  id bigserial PRIMARY KEY,
  user1_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  similarity numeric(4, 3) NOT NULL CHECK (similarity >= 0 AND similarity <= 1),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user1_id, user2_id),
  CHECK (user1_id <> user2_id)
);

CREATE INDEX IF NOT EXISTS idx_movies_title ON movies USING gin (to_tsvector('russian', title));
CREATE INDEX IF NOT EXISTS idx_movies_genres ON movies USING gin (genres);
CREATE INDEX IF NOT EXISTS idx_movies_tags ON movies USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_ratings_user_movie ON ratings (user_id, movie_id);
CREATE INDEX IF NOT EXISTS idx_ratings_movie ON ratings (movie_id);
CREATE INDEX IF NOT EXISTS idx_events_user ON user_movie_events (user_id, created_at DESC);

CREATE OR REPLACE VIEW user_preferences AS
SELECT
  r.user_id,
  genre,
  round(avg(r.rating)::numeric, 2) AS avg_rating,
  count(*) AS count_movies
FROM ratings r
JOIN movies m ON m.id = r.movie_id
CROSS JOIN unnest(m.genres) AS genre
WHERE r.rating >= 7
GROUP BY r.user_id, genre;
