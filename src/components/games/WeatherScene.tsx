/**
 * WeatherScene — the animated background of the game card's weather header:
 * a shining sun with turning rays (sunny), drifting clouds (cloudy), falling
 * rain under a dark cloud (rainy), drifting snowflakes (snowy).
 * Decorative only; styles and reduced-motion handling in weather-scene.css.
 */

import type { CSSProperties } from 'react'
import type { WeatherTheme } from '@/lib/weather'
import './weather-scene.css'

/** Deterministic 0–1 value per index (no Math.random → stable across renders). */
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

type Vars = CSSProperties & { '--wx-scale'?: number }

/** Clouds stay in the top band of the header so they never cover the text. */
function Clouds({ count, dark = false, top = -4 }: { count: number; dark?: boolean; top?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const style: Vars = {
          top: top + rand(i, 1) * 14,
          '--wx-scale': 0.5 + rand(i, 2) * 0.45,
          opacity: dark ? 0.85 : 0.45 + rand(i, 3) * 0.35,
          animationDuration: `${26 + rand(i, 4) * 22}s`,
          animationDelay: `-${rand(i, 5) * 40}s`,
        }
        return <span key={i} className={dark ? 'wx-cloud wx-cloud--dark' : 'wx-cloud'} style={style} />
      })}
    </>
  )
}

export function WeatherScene({ theme }: { theme: WeatherTheme }) {
  return (
    <div className="wx-scene" aria-hidden data-testid={`weather-scene-${theme}`}>
      {theme === 'sunny' && (
        <>
          <div className="wx-sun">
            <span className="wx-sun__glow" />
            <span className="wx-sun__rays" />
            <span className="wx-sun__disc" />
          </div>
          {Array.from({ length: 7 }, (_, i) => (
            <span
              key={i}
              className="wx-sparkle"
              style={{
                top: `${15 + rand(i, 6) * 65}%`,
                left: `${35 + rand(i, 7) * 55}%`,
                animationDelay: `${rand(i, 8) * 5}s`,
                animationDuration: `${4 + rand(i, 9) * 3}s`,
              }}
            />
          ))}
        </>
      )}

      {theme === 'cloudy' && <Clouds count={5} top={-12} />}

      {theme === 'rainy' && (
        <>
          <Clouds count={3} dark top={-14} />
          {Array.from({ length: 34 }, (_, i) => (
            <span
              key={i}
              className="wx-drop"
              style={{
                left: `${rand(i, 10) * 105}%`,
                animationDuration: `${0.7 + rand(i, 11) * 0.5}s`,
                animationDelay: `-${rand(i, 12) * 1.2}s`,
                opacity: 0.6 + rand(i, 13) * 0.4,
              }}
            />
          ))}
        </>
      )}

      {theme === 'snowy' && (
        <>
          <Clouds count={2} top={-16} />
          {Array.from({ length: 28 }, (_, i) => {
            const size = 3 + rand(i, 14) * 4
            return (
              <span
                key={i}
                className="wx-flake"
                style={{
                  left: `${rand(i, 15) * 100}%`,
                  width: size,
                  height: size,
                  animationDuration: `${5 + rand(i, 16) * 5}s`,
                  animationDelay: `-${rand(i, 17) * 8}s`,
                  opacity: 0.7 + rand(i, 18) * 0.3,
                }}
              />
            )
          })}
        </>
      )}
    </div>
  )
}
