import React, { createContext, useContext, useEffect, useState } from 'react';
import { currentSeason, msUntil, Season } from '../utils/season';

type SeasonCtx = {
  season: Season;
  msRemaining: number;
};

const Ctx = createContext<SeasonCtx | null>(null);

export function SeasonProvider({ children }: { children: React.ReactNode }) {
  const [season, setSeason] = useState<Season>(() => currentSeason());
  const [msRemaining, setMs] = useState<number>(() => msUntil(season.endMs));

  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      if (now >= season.endMs) {
        // Roll into next season at month boundary.
        const next = currentSeason(new Date(now));
        setSeason(next);
        setMs(msUntil(next.endMs, now));
      } else {
        setMs(msUntil(season.endMs, now));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [season.endMs]);

  return <Ctx.Provider value={{ season, msRemaining }}>{children}</Ctx.Provider>;
}

export function useSeason(): SeasonCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSeason must be used inside SeasonProvider');
  return ctx;
}
