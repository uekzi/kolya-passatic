export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });

  const rotatedToken = response.headers.get("x-rotated-token");
  if (rotatedToken && typeof window !== "undefined") {
    localStorage.setItem("kinoMoodToken", rotatedToken);
    window.dispatchEvent(new CustomEvent("kino-token-rotated", { detail: rotatedToken }));
  }

  if (!response.ok) {
    let message = "Ошибка запроса.";
    try {
      const data = await response.json();
      message = data.message || message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  return response.json();
}
