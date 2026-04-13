import { destinationPoint, distanceKm, bearingTo, hoursAgo, STRATEGIC_CHOKEPOINTS } from './geo-utils';

export interface ProjectedPosition {
  lat: number;
  lng: number;
  uncertainty_radius_km: number;
  hours_projected: number;
  confidence: number;
  estimated_chokepoint_arrivals: ChokePointETA[];
}

export interface ChokePointETA {
  chokepoint: string;
  eta_hours: number;
  distance_km: number;
}

/**
 * Project forward from a last-known position using dead reckoning.
 * Uncertainty grows linearly with time.
 */
export function projectPosition(
  lastKnown: {
    lat: number;
    lng: number;
    heading: number;
    speed_knots: number;
    timestamp: string;
  },
  toTimestamp?: string,
): ProjectedPosition {
  const hoursElapsed = hoursAgo(lastKnown.timestamp, toTimestamp);
  const distanceNm = lastKnown.speed_knots * hoursElapsed;
  const distKm = distanceNm * 1.852;

  const projected = destinationPoint(
    lastKnown.lat,
    lastKnown.lng,
    lastKnown.heading,
    distKm,
  );

  // Uncertainty: 15% of projected distance, min 5km
  const uncertaintyRadiusKm = Math.max(5, distKm * 0.15);

  // Confidence decays over time
  const confidence = Math.max(0.1, 0.9 - hoursElapsed * 0.08);

  const estimated_chokepoint_arrivals = calculateETAToChokepoints(
    projected,
    lastKnown.heading,
    lastKnown.speed_knots,
  );

  return {
    lat: projected.lat,
    lng: projected.lng,
    uncertainty_radius_km: uncertaintyRadiusKm,
    hours_projected: hoursElapsed,
    confidence,
    estimated_chokepoint_arrivals,
  };
}

function calculateETAToChokepoints(
  position: { lat: number; lng: number },
  heading: number,
  speedKnots: number,
): ChokePointETA[] {
  if (speedKnots <= 0) return [];

  return STRATEGIC_CHOKEPOINTS
    .map(cp => {
      const distance = distanceKm(position.lat, position.lng, cp.lat, cp.lng);
      const bearing = bearingTo(position.lat, position.lng, cp.lat, cp.lng);
      const headingDiff = Math.abs(((heading - bearing + 180) % 360) - 180);

      // Only include chokepoints roughly in the direction of travel
      if (headingDiff > 45) return null;

      const etaHours = (distance / 1.852) / speedKnots;
      return { chokepoint: cp.name, eta_hours: etaHours, distance_km: distance };
    })
    .filter((x): x is ChokePointETA => x !== null)
    .sort((a, b) => a.eta_hours - b.eta_hours)
    .slice(0, 3);
}

/**
 * Generate a fan of possible positions accounting for heading uncertainty.
 * Useful for map visualization of dark ship projected areas.
 */
export function projectPositionFan(
  lastKnown: {
    lat: number;
    lng: number;
    heading: number;
    speed_knots: number;
    timestamp: string;
  },
  headingUncertaintyDeg: number = 15,
  speedUncertaintyPct: number = 0.2,
): { center: ProjectedPosition; fan: { lat: number; lng: number }[] } {
  const center = projectPosition(lastKnown);
  const hoursElapsed = hoursAgo(lastKnown.timestamp);
  const fan: { lat: number; lng: number }[] = [];

  // Generate fan edges: vary heading and speed
  for (const hDelta of [-headingUncertaintyDeg, 0, headingUncertaintyDeg]) {
    for (const sFactor of [1 - speedUncertaintyPct, 1, 1 + speedUncertaintyPct]) {
      const adjHeading = (lastKnown.heading + hDelta + 360) % 360;
      const adjSpeed = lastKnown.speed_knots * sFactor;
      const distKm = (adjSpeed * hoursElapsed) * 1.852;
      const point = destinationPoint(lastKnown.lat, lastKnown.lng, adjHeading, distKm);
      fan.push(point);
    }
  }

  return { center, fan };
}
