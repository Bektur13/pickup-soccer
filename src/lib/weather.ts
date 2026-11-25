/**
 * Weather for a game — shared by the worker endpoint
 * (GET /api/games/:gameId/weather) and the game card.
 *
 * Codes are WMO weather interpretation codes as returned by Open-Meteo:
 * https://open-meteo.com/en/docs (section "WMO Weather interpretation codes").
 */

export type WeatherTheme = 'sunny' | 'cloudy' | 'rainy' | 'snowy'

/** Open-Meteo's forecast reaches 16 days ahead (`forecast_days` max 16). */
export const FORECAST_HORIZON_DAYS = 16

export type GameWeather =
  | {
      available: true
      theme: WeatherTheme
      weatherCode: number
      temperatureF: number
      /** Chance of precipitation that hour, 0–100. */
      precipitationProbability: number | null
      /** The forecast hour used, UTC ISO ("2026-11-28T17:00Z"). */
      forecastHour: string
    }
  | {
      available: false
      /** too_far: more than 16 days out · past: game is over · unavailable: provider error. */
      reason: 'too_far' | 'past' | 'unavailable'
      /** For too_far: roughly when the forecast becomes available. */
      availableFrom?: string
    }

/**
 * Map a WMO weather code to one of the four card themes.
 *   0–1 clear / mainly clear                 → sunny
 *   2–3 partly cloudy / overcast, 45–48 fog  → cloudy
 *   51–67 drizzle & rain (incl. freezing),
 *   80–82 rain showers, 95–99 thunderstorm   → rainy
 *   71–77 snow & snow grains, 85–86 snow showers → snowy
 * Anything unknown falls back to cloudy (the neutral theme).
 */
export function themeForWeatherCode(code: number): WeatherTheme {
  if (code === 0 || code === 1) return 'sunny'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowy'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)) {
    return 'rainy'
  }
  return 'cloudy'
}

/** Short human label for a weather code, e.g. "Light rain". */
export function describeWeatherCode(code: number): string {
  if (code === 0) return 'Clear sky'
  if (code === 1) return 'Mostly clear'
  if (code === 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code === 45 || code === 48) return 'Fog'
  if (code >= 51 && code <= 57) return 'Drizzle'
  if (code === 61 || code === 80) return 'Light rain'
  if (code === 63 || code === 81) return 'Rain'
  if (code === 65 || code === 82) return 'Heavy rain'
  if (code === 66 || code === 67) return 'Freezing rain'
  if (code >= 71 && code <= 77) return 'Snow'
  if (code === 85 || code === 86) return 'Snow showers'
  if (code >= 95) return 'Thunderstorm'
  return 'Cloudy'
}
